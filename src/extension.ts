import * as vscode from 'vscode';
import { GitExtension, Repository } from './api/git';

import { exec } from 'child_process';

interface OpenFilesInterface {
	file: string;
	line: number;
	column: number;
	lastModified: number;
	event: any;
}

let openFiles: OpenFilesInterface[] = [];
let activeEditor = vscode.window.activeTextEditor;
let documentChangeListenerDisposer: vscode.Disposable;
let activeTextEditorChangeDisposer: vscode.Disposable;

// Taken from https://github.com/alefragnani/vscode-bookmarks/blob/master/src/extension.ts
function revealPosition(line: number, column: number) {
	if (!vscode.window.activeTextEditor) {
		return false;
	}
	let reviewType: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter;
	if (line === vscode.window.activeTextEditor.selection.active.line) {
		reviewType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
	}
	const newSe = new vscode.Selection(line, column, line, column);
	vscode.window.activeTextEditor.selection = newSe;
	vscode.window.activeTextEditor.revealRange(newSe, reviewType);
}

export function activate(context: vscode.ExtensionContext) {

	let commitMessage = vscode.commands.registerCommand('mobTools.commitMessage', async (uri?) => {
		const git = getGitExtension();

		if (!git) {
			vscode.window.showErrorMessage('Unable to load Git Extension');
			return;
		}

		vscode.commands.executeCommand('workbench.view.scm');

		if (uri) {
			const selectedRepository = git.repositories.find(repository => {
				return repository.rootUri.path === uri._rootUri.path;
			});

			if (selectedRepository) {
				await prefixCommit(selectedRepository);
			}
		} else {
			for (let repo of git.repositories) {
				await prefixCommit(repo);
			}
		}
	});

	let gitParse = vscode.commands.registerCommand('mobTools.gitParse', () => {
		exec('git log --pretty=format:%s -1', {cwd: vscode.workspace.rootPath}, (err, stdout, stderr) => {
			if (err || stderr) {
				throw err ? err : stderr;
			}

			// @TODO: Throw error if invalid json
			const match = stdout.match(/╠(.*)╣/);
			if (match && match[1]) {
				const data = JSON.parse(match[1]);
				data.reverse();
				data.forEach((file: any, index: number) => {
					const uri = vscode.Uri.file(vscode.workspace.rootPath + '/' + file[0]);
					vscode.workspace.openTextDocument(uri).then((documentHandle: vscode.TextDocument) => {
						vscode.window.showTextDocument(documentHandle, {
							preview: false,
							preserveFocus: index !== (data.length - 1),
							viewColumn: vscode.ViewColumn.Active
						}).then(editor => {
							revealPosition(file[1], file[2]);
						});
					});
				});
			}
		});

		// terminal.dispose();
		// TODO: PhpStorm Plugin
	});

	context.subscriptions.push(commitMessage);
	context.subscriptions.push(gitParse);

	activeTextEditorChangeDisposer = vscode.window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor, null, context.subscriptions);
	documentChangeListenerDisposer = vscode.workspace.onDidChangeTextDocument(onDidChangeTextDocument);
}

async function prefixCommit(repository: Repository) {
	const prefixPattern: string = (vscode.workspace.getConfiguration().get("mobTools.pattern") || '(.*)') + '(?=-)';
	const prefixPatternSimple: string = '\\[' + (vscode.workspace.getConfiguration().get("mobTools.pattern") || '(.*)') + '] ';

	const ignoreCase: boolean = vscode.workspace.getConfiguration().get("mobTools.patternIgnoreCase") || false;

	const branchRegEx = ignoreCase ? new RegExp(prefixPattern, 'i') : new RegExp(prefixPattern);
	const branchRegexSimple = ignoreCase ? new RegExp(prefixPatternSimple, 'i') : new RegExp(prefixPatternSimple);

	const prefixReplacement: string = vscode.workspace.getConfiguration().get("mobTools.replacement") || '[$1] ';
	const branchName = repository.state.HEAD && repository.state.HEAD.name || '';

	const mobTime: number = vscode.workspace.getConfiguration().get("mobTools.mobTime") || 15;
	let workspaceStatusStringBuilder: any = [];

	openFiles.sort((a, b) => b.lastModified - a.lastModified);
	openFiles.forEach(file => {
		if ((new Date().getTime() - file.lastModified) < (mobTime * 1000 * 60)) {
			var path = vscode.workspace.asRelativePath(file.file);
			path = path.replace(/\\/g, '/');

			workspaceStatusStringBuilder.push([path, file.line, file.column]);
		}
	});

	// TODO: record and add breakpoints

	const workspaceStatusString = '╠' + JSON.stringify(workspaceStatusStringBuilder) + '╣';

	if (branchRegEx.test(branchName)) {
		const match = branchRegEx.exec(branchName);
		const ticket = match ? match[0] : '';

		repository.inputBox.value = repository.inputBox.value.replace(branchRegexSimple, '');
		repository.inputBox.value = repository.inputBox.value.replace(/ ╠(.*)╣/, '');

		repository.inputBox.value = `${prefixReplacement}${repository.inputBox.value} ${workspaceStatusString}`.replace('$1', ticket);
	} else {
		const message = `Pattern ${prefixPattern} not found in branch ${branchName}`;
		const editPattern = 'Edit Pattern';
		let result = await vscode.window.showErrorMessage(message, { modal: false }, editPattern);
		if (result === editPattern) {
			vscode.commands.executeCommand('workbench.action.openSettings');
			vscode.commands.executeCommand('settings.action.clearSearchResults');
		}
	}
}

function onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined) {
	activeEditor = editor;
}

function onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
	if (!activeEditor || activeEditor.document !== event.document || !vscode.window.activeTextEditor) {
		return;
	}

	if (event.document.uri.scheme !== 'file') {
		return;
	}

	const index = openFiles.findIndex(file => file.file === event.document.fileName);

	const currentLine = vscode.window.activeTextEditor.selection.active.line;
	const currentColumn = vscode.window.activeTextEditor.selection.active.character;
	if (index !== -1) {
		openFiles[index].line = currentLine;
		openFiles[index].column = currentColumn;
		openFiles[index].lastModified = new Date().getTime();
	} else {
		openFiles.push({
			file: event.document.fileName,
			line: currentLine,
			column: currentColumn,
			lastModified: new Date().getTime(),
			event: event
		});
	}
}

function getGitExtension() {
	const vscodeGit = vscode.extensions.getExtension<GitExtension>('vscode.git');
	const gitExtension = vscodeGit && vscodeGit.exports;
	return gitExtension && gitExtension.getAPI(1);
}

export function deactivate() {}
