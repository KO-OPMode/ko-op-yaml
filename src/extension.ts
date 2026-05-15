import * as vscode from 'vscode';
import { YamlIncludeDefinitionProvider, YamlIncludeHoverProvider, YamlIncludeCompletionProvider } from './providers/yaml_include_provider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "ko-op-yaml" is now active!');

    const disposable = vscode.commands.registerCommand('ko-op-yaml.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from ko-op-yaml!');
    });

    const yamlSelector: vscode.DocumentSelector = { language: 'yaml', scheme: 'file', pattern: '**/Configs/**/*.yaml' };

	context.subscriptions.push(
		disposable,
		vscode.languages.registerDefinitionProvider(yamlSelector, new YamlIncludeDefinitionProvider()),
		vscode.languages.registerHoverProvider(yamlSelector, new YamlIncludeHoverProvider()),
		vscode.languages.registerCompletionItemProvider(yamlSelector, new YamlIncludeCompletionProvider(), ' ', '[', ',', '$')
	);
}

export function deactivate() {}