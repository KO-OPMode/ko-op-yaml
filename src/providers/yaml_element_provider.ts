import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// maps recognized YAML keys to their source file paths relative to the Configs root.
const element_key_mapping: Record<string, string> = {
    'Item':             path.join('Source', 'Items.yaml'),
    'Items':            path.join('Source', 'Items.yaml'),
    'Droptable':        path.join('Source', 'Droptables.yaml'),
    'Locale':           path.join('Source', 'World', 'Locales.yaml'),
    'Tableau':          path.join('Source', 'World', 'Tableaus.yaml'),
    'SpawnTable':       path.join('Source', 'World', 'PrefabSpawnTables.yaml'),
    'Reward':           path.join('Source', 'Economy', 'Rewards.yaml'),
    'ConverterTypes':   path.join('Source', 'Crafting', 'RecipeConverters.yaml'),
    'Faction':          path.join('Source', 'Factions.yaml'),
    'Professions':      path.join('Source', 'NPCs', 'Professions.yaml'),
    'Communities':      path.join('Source', 'NPCs', 'Communities.yaml'),
    'Cultures':         path.join('Source', 'NPCs', 'Cultures.yaml'),
    'DefaultMood':      path.join('Source', 'NPCs', 'Moods.yaml'),
    'HomeSite':         path.join('Source', 'World', 'Sites.yaml'),
    'Site':             path.join('Source', 'World', 'Sites.yaml'),
    'HomeRegion':       path.join('Source', 'World', 'Regions.yaml'),
    'ShopItem':         path.join('Source', 'Economy', 'ShopItems.yaml'),
    'ShopItems':        path.join('Source', 'Economy', 'ShopItems.yaml'),
    'Recipe':           path.join('Source', 'Crafting', 'Recipes.yaml'),
};

// regex built from the map keys for parsing
const element_key_regex = Object.keys(element_key_mapping).join('|');

interface ElementDef
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
 * Walk up the directory tree to find the Configs root: a directory that
 * contains both Source/ and Include/ subdirectories.
 */
function findConfigsRoot(filePath: string): string | undefined
{
    let dir = path.dirname(filePath);
    while (true)
    {
        try
        {
            if (
                fs.statSync(path.join(dir, 'Source')).isDirectory() &&
                fs.statSync(path.join(dir, 'Include')).isDirectory()
            )
            {
                return dir;
            }
        } catch { /* keep walking */ }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

function getElementFilePath(keyType: string, configsRoot: string): string | undefined
{
    const rel = element_key_mapping[keyType];
    return rel ? path.join(configsRoot, rel) : undefined;
}

/**
 * Parse an element reference from a key: value or key: [v1, v2] line at the cursor.
 * Handles leading whitespace and an optional `- ` list indicator before the key.
 */
function parseElementKeyValueAtPosition(
    lineText: string,
    character: number
): { keyType: string; name: string } | undefined
{
    const match = lineText.match(new RegExp(`^(\\s*(?:-\\s+)?(${element_key_regex}):\\s*)(\\S.*)$`));
    if (!match) return undefined;

    const keyType = match[2];
    const valueStart = match[1].length;
    const valueStr = match[3].trimEnd();

    if (valueStr.startsWith('[') && valueStr.endsWith(']'))
    {
        // inline list: Items: [A, B]
        const inner = valueStr.slice(1, -1);
        const innerStart = valueStart + 1;
        let pos = 0;
        for (const segment of inner.split(','))
        {
            const raw = segment.trim();
            if (raw.length > 0)
            {
                const itemStart = innerStart + pos + segment.indexOf(raw);
                const itemEnd = itemStart + raw.length;
                if (character >= itemStart && character <= itemEnd)
                {
                    return { keyType, name: raw };
                }
            }
            pos += segment.length + 1; // +1 for the comma
        }
        return undefined;
    }
    else
    {
        // Single value: Item: Name
        if (character >= valueStart && character <= valueStart + valueStr.length)
        {
            return { keyType, name: valueStr };
        }
        return undefined;
    }
}

/**
 * For a bare list-item line (e.g. `  - EggSandwich`), scan backwards to find
 * the enclosing element key (e.g. `Items:`). Returns the key type or undefined.
 *
 * Only matches enclosing keys that have no inline value (i.e. block list form):
 *   Items:          <- matches
 *   Items: [A, B]   <- does NOT match (inline list, not a block list parent)
 */
function findEnclosingElementKey(
    document: vscode.TextDocument,
    lineNumber: number,
    dashIndent: number
): string | undefined
{
    const keyPattern = new RegExp(`^(\\s*(?:-\\s+)?)(${element_key_regex}):\\s*(#.*)?$`);
    for (let i = lineNumber - 1; i >= 0; i--)
    {
        const text = document.lineAt(i).text;
        if (text.trim() === '') continue;                  // blank line — skip
        if (text.trimStart().startsWith('#')) continue;    // comment — skip
        const firstNonSpace = text.search(/\S/);
        if (firstNonSpace >= dashIndent) continue;         // same or deeper indent — skip
        const m = keyPattern.exec(text);
        if (m) return m[2];
        break; // less-indented non-matching line — stop
    }
    return undefined;
}

/**
 * Full element reference parser: handles key-value, inline list, and bare list items.
 */
function parseElementRefAtPosition(
    lineText: string,
    character: number,
    document: vscode.TextDocument,
    lineNumber: number
): { keyType: string; name: string } | undefined
{
    // try `key: value` or `key: [v, v]` first (covers `- key: value` too)
    const kvResult = parseElementKeyValueAtPosition(lineText, character);
    if (kvResult) return kvResult;

    // try bare list item: `  - SomeName` (pure string list item, no key on this line)
    const listItemMatch = lineText.match(/^(\s*-\s+)([A-Za-z][A-Za-z0-9_]*)\s*(#.*)?$/);
    if (listItemMatch)
    {
        const nameStart = listItemMatch[1].length;
        const name = listItemMatch[2];
        if (character >= nameStart && character <= nameStart + name.length)
        {
            const dashIndent = lineText.search(/\S/); // column of '-'
            const keyType = findEnclosingElementKey(document, lineNumber, dashIndent);
            if (keyType) return { keyType, name };
        }
    }

    return undefined;
}

/**
 * Search the Elements: block of a YAML file for a specific named key.
 * Returns the file path, line number, and full block content.
 */
function searchElementDefinition(filePath: string, name: string): ElementDef | undefined
{
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf8'); }
    catch { return undefined; }

    const lines = content.split('\n');
    const keyPattern = new RegExp(`^  (${escapeRegex(name)})\\s*:`);
    let inElements = false;

    for (let i = 0; i < lines.length; i++)
    {
        if (!inElements)
        {
            if (/^Elements:\s*(#.*)?$/.test(lines[i])) inElements = true;
            continue;
        }
        // Exit the Elements block on any top-level non-comment non-empty line
        if (lines[i].length > 0 && !/^\s/.test(lines[i]) && !lines[i].startsWith('#')) break;

        if (!keyPattern.test(lines[i])) continue;

        // Collect the block: key line + all lines indented at 3+ spaces (or blank)
        const blockLines = [lines[i]];
        for (let j = i + 1; j < lines.length; j++)
        {
            const line = lines[j];
            if (line.trim() === '' || line.startsWith('   ') || line.startsWith('\t'))
            {
                blockLines.push(line);
                continue;
            }
            break;
        }
        while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === '')
        {
            blockLines.pop();
        }
        return { filePath, lineNumber: i, content: blockLines.join('\n') };
    }
    return undefined;
}

/**
 * Read all element definitions from the Elements: block of a YAML file.
 */
function getAllElementDefinitions(filePath: string): Array<{ name: string; content: string; fileName: string }>
{
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf8'); }
    catch { return []; }

    const fileName = path.basename(filePath);
    const lines = content.split('\n');
    const results: Array<{ name: string; content: string; fileName: string }> = [];
    const keyPattern = /^  ([A-Za-z][A-Za-z0-9_]*)\s*:/;
    let inElements = false;

    for (let i = 0; i < lines.length; i++)
    {
        if (!inElements)
        {
            if (/^Elements:\s*(#.*)?$/.test(lines[i])) inElements = true;
            continue;
        }
        if (lines[i].length > 0 && !/^\s/.test(lines[i]) && !lines[i].startsWith('#')) break;

        const keyMatch = keyPattern.exec(lines[i]);
        if (!keyMatch) continue;

        const name = keyMatch[1];
        const blockLines = [lines[i]];
        for (let j = i + 1; j < lines.length; j++)
        {
            const line = lines[j];
            if (line.trim() === '' || line.startsWith('   ') || line.startsWith('\t'))
            {
                blockLines.push(line);
                continue;
            }
            break;
        }
        while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === '')
        {
            blockLines.pop();
        }
        results.push({ name, content: blockLines.join('\n'), fileName });
    }

    return results;
}

export class YamlElementDefinitionProvider implements vscode.DefinitionProvider
{
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition>
    {
        const lineText = document.lineAt(position.line).text;
        const ref = parseElementRefAtPosition(lineText, position.character, document, position.line);
        if (!ref) return undefined;

        const configsRoot = findConfigsRoot(document.fileName);
        if (!configsRoot) return undefined;

        const filePath = getElementFilePath(ref.keyType, configsRoot);
        if (!filePath) return undefined;

        const def = searchElementDefinition(filePath, ref.name);
        if (!def) return undefined;

        return new vscode.Location(
            vscode.Uri.file(def.filePath),
            new vscode.Position(def.lineNumber, 0)
        );
    }
}

export class YamlElementHoverProvider implements vscode.HoverProvider
{
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover>
    {
        const lineText = document.lineAt(position.line).text;
        const ref = parseElementRefAtPosition(lineText, position.character, document, position.line);
        if (!ref) return undefined;

        const configsRoot = findConfigsRoot(document.fileName);
        if (!configsRoot) return undefined;

        const filePath = getElementFilePath(ref.keyType, configsRoot);
        if (!filePath) return undefined;

        const def = searchElementDefinition(filePath, ref.name);
        if (!def) return undefined;

        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(def.content, 'yaml');
        return new vscode.Hover(markdown);
    }
}

export class YamlElementCompletionProvider implements vscode.CompletionItemProvider
{
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[]>
    {
        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.slice(0, position.character);

        let keyType: string | undefined;
        let valueAreaStart: number | undefined;

        // Key: value or Key: [..] pattern (handles `Item:`, `Items:`, `- Item:`, etc.)
        const keyMatch = linePrefix.match(new RegExp(`^(\\s*(?:-\\s+)?(${element_key_regex}):\\s*)`));
        if (keyMatch && position.character >= keyMatch[1].length)
        {
            keyType = keyMatch[2];
            valueAreaStart = keyMatch[1].length;
        }

        if (!keyType)
        {
            // bare list item `  - ` where context determines type
            const bareMatch = linePrefix.match(/^(\s*-\s+)/);
            if (bareMatch && position.character >= bareMatch[1].length)
            {
                const dashIndent = lineText.search(/\S/);
                keyType = findEnclosingElementKey(document, position.line, dashIndent);
                valueAreaStart = bareMatch[1].length;
            }
        }

        if (!keyType || valueAreaStart === undefined) return undefined;

        const configsRoot = findConfigsRoot(document.fileName);
        if (!configsRoot) return undefined;

        const filePath = getElementFilePath(keyType, configsRoot);
        if (!filePath) return undefined;

        // compute the range of the token currently being typed
        const typedInValueArea = linePrefix.slice(valueAreaStart);
        const currentToken = typedInValueArea.split(/[,\[\]]/).pop()?.trimStart() ?? '';
        const tokenStart = position.character - currentToken.length;
        const itemRange = new vscode.Range(position.line, tokenStart, position.line, position.character);

        return getAllElementDefinitions(filePath).map(def =>
        {
            const item = new vscode.CompletionItem(def.name, vscode.CompletionItemKind.Reference);
            item.detail = def.fileName;
            item.range = itemRange;
            const docs = new vscode.MarkdownString();
            docs.appendCodeblock(def.content, 'yaml');
            item.documentation = docs;
            return item;
        });
    }
}
