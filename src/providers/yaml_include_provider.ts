import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface IncludeDefinition
{
    filePath: string;
    lineNumber: number;
    content: string;
}

function escapeRegex(str: string): string
{
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk up the directory tree from the given file, looking for a parent
 * directory that contains an "Include/" subdirectory with .yaml files.
 * For a source file at Configs/Source/World/Sites.yaml, this finds Configs/.
 */
function findIncludeDirectory(filePath: string): string | undefined
{
    let dir = path.dirname(filePath);
    while (true)
    {
        const candidate = path.join(dir, 'Include');
        try
        {
            if (fs.statSync(candidate).isDirectory())
            {
                const files = fs.readdirSync(candidate);
                if (files.some(f => f.endsWith('.yaml')))
                {
                    return candidate;
                }
            }
        } catch
        {
            // not found at this level, keep walking up
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break; // reached filesystem root
        dir = parent;
    }
    return undefined;
}

/**
 * Given a line like `include: Name` or `include: [Name1, Name2]`
 * and a cursor character offset, returns the include name under the cursor,
 * or undefined if the cursor is not on an include value.
 * Works with optional $ prefix: `include: $Name` or `include: [$Name1, $Name2]`
 */
function parseIncludeAtPosition(lineText: string, character: number): string | undefined
{
    // match the include key and its value
    const match = lineText.match(/^(\s*include:\s*)(\S.*)$/);
    if (!match)
    {
        return undefined;
    }

    const valueStart = match[1].length;
    const valueStr = match[2].trimEnd();

    if (valueStr.startsWith('[') && valueStr.endsWith(']'))
    {
        // list syntax: include: [$Name1, $Name2]
        const inner = valueStr.slice(1, -1);
        const innerStart = valueStart + 1;
        let pos = 0;
        for (const segment of inner.split(','))
        {
            const raw = segment.trim(); // keep $ for accurate position matching
            if (raw.length > 0)
            {
                const itemStart = innerStart + pos + segment.indexOf(raw);
                const itemEnd = itemStart + raw.length;
                if (character >= itemStart && character <= itemEnd)
                {
                    return raw.replace(/^\$/, '');
                }
            }
            pos += segment.length + 1; // +1 for the comma
        }
        return undefined;
    }
    else
    {
        // single value: include: $Name ($ is optional)
        if (character >= valueStart && character <= valueStart + valueStr.length)
        {
            return valueStr.replace(/^\$/, '');
        }
        return undefined;
    }
}

/**
 * Search all .yaml files in the given include directory for a top-level
 * key matching `name`. Returns the file path, line number, and block content.
 */
function searchIncludeDefinition(includeDir: string, name: string): IncludeDefinition | undefined
{
    let files: string[];
    try
    {
        files = fs.readdirSync(includeDir).filter(f => f.endsWith('.yaml'));
    } catch
    {
        return undefined;
    }

    const keyPattern = new RegExp(`^(${escapeRegex(name)})\\s*:`);

    for (const file of files)
    {
        const filePath = path.join(includeDir, file);
        let fileContent: string;
        try
        {
            fileContent = fs.readFileSync(filePath, 'utf8');
        }
        catch
        {
            continue;
        }

        const lines = fileContent.split('\n');
        for (let i = 0; i < lines.length; i++)
        {
            if (!keyPattern.test(lines[i]))
            {
                continue;
            }

            // collect the entire block: the key line + all indented/empty lines below it
            const blockLines: string[] = [lines[i]];
            for (let j = i + 1; j < lines.length; j++)
            {
                const line = lines[j];
                // a new top-level key is non-indented, non-empty, non-comment
                if (
                    line.length > 0 &&
                    !line.startsWith(' ') &&
                    !line.startsWith('\t') &&
                    !line.startsWith('#') &&
                    !line.startsWith('-')
                )
                {
                    break;
                }
                blockLines.push(line);
            }

            // trim trailing blank lines from the block
            while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === '')
            {
                blockLines.pop();
            }

            return {
                filePath,
                lineNumber: i,
                content: blockLines.join('\n'),
            };
        }
    }
    return undefined;
}

function getAllIncludeDefinitions(includeDir: string): Array<{ name: string; content: string; fileName: string }>
{
    let files: string[];
    try
    {
        files = fs.readdirSync(includeDir).filter((f: string) => f.endsWith('.yaml'));
    } catch
    {
        return [];
    }

    const results: Array<{ name: string; content: string; fileName: string }> = [];
    const topLevelKeyPattern = /^(\$?[A-Za-z][A-Za-z0-9_$]*)\s*:/;

    for (const file of files)
    {
        const filePath = path.join(includeDir, file);
        let fileContent: string;
        try
        {
            fileContent = fs.readFileSync(filePath, 'utf8');
        }
        catch
        {
            continue;
        }

        const lines = fileContent.split('\n');
        for (let i = 0; i < lines.length; i++)
        {
            const keyMatch = topLevelKeyPattern.exec(lines[i]);
            if (!keyMatch)
            {
                continue;
            }

            const name = keyMatch[1];
            const blockLines: string[] = [lines[i]];
            for (let j = i + 1; j < lines.length; j++)
            {
                const line = lines[j];
                if (
                    line.length > 0 &&
                    !line.startsWith(' ') &&
                    !line.startsWith('\t') &&
                    !line.startsWith('#') &&
                    !line.startsWith('-')
                )
                {
                    break;
                }
                blockLines.push(line);
            }
            while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === '')
            {
                blockLines.pop();
            }

            results.push({ name, content: blockLines.join('\n'), fileName: file });
        }
    }

    return results;
}

export class YamlIncludeDefinitionProvider implements vscode.DefinitionProvider
{
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition>
    {
        const lineText = document.lineAt(position.line).text;
        const includeName = parseIncludeAtPosition(lineText, position.character);
        if (!includeName)
        {
            return undefined;
        }

        const includeDir = findIncludeDirectory(document.fileName);
        if (!includeDir)
        {
            return undefined;
        }

        const definition = searchIncludeDefinition(includeDir, includeName);
        if (!definition)
        {
            return undefined;
        }

        return new vscode.Location(
            vscode.Uri.file(definition.filePath),
            new vscode.Position(definition.lineNumber, 0)
        );
    }
}

export class YamlIncludeHoverProvider implements vscode.HoverProvider
{
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover>
    {
        const lineText = document.lineAt(position.line).text;
        const includeName = parseIncludeAtPosition(lineText, position.character);
        if (!includeName)
        {
            return undefined;
        }

        const includeDir = findIncludeDirectory(document.fileName);
        if (!includeDir)
        {
            return undefined;
        }

        const definition = searchIncludeDefinition(includeDir, includeName);
        if (!definition)
        {
            return undefined;
        }

        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(definition.content, 'yaml');
        return new vscode.Hover(markdown);
    }
}

export class YamlIncludeCompletionProvider implements vscode.CompletionItemProvider
{
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]>
    {
        const lineText = document.lineAt(position.line).text;

        // only trigger on include: value positions
        const includeLineMatch = lineText.match(/^(\s*include:\s*)/);
        if (!includeLineMatch || position.character < includeLineMatch[1].length)
        {
            return undefined;
        }

        const includeDir = findIncludeDirectory(document.fileName);
        if (!includeDir)
        {
            return undefined;
        }

        // detect if the current token starts with $ to configure filterText and range
        const valueStart = includeLineMatch[1].length;
        const textSoFar = lineText.slice(valueStart, position.character);
        const currentSegment = textSoFar.split(/[,\[]/).pop() ?? '';
        const segmentTrimmed = currentSegment.trimStart();
        const hasDollar = segmentTrimmed.startsWith('$');
        const itemCharStart = position.character - segmentTrimmed.length;
        const itemRange = new vscode.Range(position.line, itemCharStart, position.line, position.character);

        return getAllIncludeDefinitions(includeDir).map(def =>
        {
            const item = new vscode.CompletionItem(def.name, vscode.CompletionItemKind.Reference);
            // when not expanded, show a preview of the content in the detail field (first 2 non-empty lines)
            // const preview = def.content.split('\n').slice(1, 3).map(l => l.trim()).filter(Boolean).join('  ');
            // item.detail = `${def.fileName}${preview ? `  —  ${preview}` : ''}`;
            item.detail = def.fileName;
            item.range = itemRange;
            if (hasDollar)
            {
                item.filterText = '$' + def.name;
            }
            const docs = new vscode.MarkdownString();
            docs.appendCodeblock(def.content, 'yaml');
            item.documentation = docs;
            return item;
        });
    }
}
