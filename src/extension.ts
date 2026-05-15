import * as vscode from 'vscode';
import { YamlIncludeDefinitionProvider, YamlIncludeHoverProvider, YamlIncludeCompletionProvider } from './providers/yaml_include_provider';
import { YamlElementDefinitionProvider, YamlElementHoverProvider, YamlElementCompletionProvider } from './providers/yaml_element_provider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "ko-op-yaml" is now active 2!');

    const disposable = vscode.commands.registerCommand('ko-op-yaml.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from ko-op-yaml 2!');
    });

    const yamlSelector: vscode.DocumentSelector = { language: 'yaml', scheme: 'file', pattern: '**/Configs/**/*.yaml' };

	context.subscriptions.push(
		disposable,
		vscode.languages.registerDefinitionProvider(yamlSelector, new YamlIncludeDefinitionProvider()),
		vscode.languages.registerHoverProvider(yamlSelector, new YamlIncludeHoverProvider()),
		vscode.languages.registerCompletionItemProvider(yamlSelector, new YamlIncludeCompletionProvider(), ' ', '[', ',', '$'),
		vscode.languages.registerDefinitionProvider(yamlSelector, new YamlElementDefinitionProvider()),
		vscode.languages.registerHoverProvider(yamlSelector, new YamlElementHoverProvider()),
		vscode.languages.registerCompletionItemProvider(yamlSelector, new YamlElementCompletionProvider(), ' ', '[', ',')
	);
}

export function deactivate() {}