'use strict';
import * as vscode from 'vscode';
import PloneFS, { CookieStore, Cookie } from './PloneFS';
import { Document, File, PloneObject, LocalCss, Folder } from './library/plone';
const cookieStoreName = 'cookieStore';

export async function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders !== undefined) {
		let cookies: CookieStore = {};
		for (const folder of vscode.workspace.workspaceFolders) {
			if (folder.uri.scheme === 'plone') {
				const cookie = await login(folder.uri);
				if (cookie === undefined) {
					throw vscode.FileSystemError.NoPermissions('Unable to open site: login cancelled');
				}
				cookies[getSiteName(folder.uri)] = cookie;
			}
		}
		if (Object.keys(cookies).length) {
			const ploneFS = new PloneFS(cookies);
			context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFS, { isCaseSensitive: false }));
			// to VS Code Plone Documents and Plone Files are both TextDocuments
			// so set Plone Documents to be HTML and Files to be whatever we determined them to be
			// (unless VS Code already figured it out)
			context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async doc => {
				if (doc.languageId === 'plaintext') {
					const stat: vscode.FileStat = await ploneFS.stat(doc.uri);
					if (stat instanceof Document) {
						vscode.languages.setTextDocumentLanguage(doc, 'html');
					}
					else if (stat instanceof File && stat.language && stat.language !== 'plaintext') {
						vscode.languages.setTextDocumentLanguage(doc, stat.language);
					}
					else if (stat instanceof LocalCss) {
						vscode.languages.setTextDocumentLanguage(doc, 'css');
					}
				}
			}));

			async function setSetting(uri: vscode.Uri, settingName: string) {
				const stat = await ploneFS.stat(uri);
				if (stat instanceof PloneObject) {
					let cookie: Cookie | undefined;
					if (!stat.loaded) {
						cookie = ploneFS.getCookie(uri);
						await stat.load(cookie);
					}
					const oldBuffer = stat.settings.get(settingName);
					const newValue = await vscode.window.showInputBox({
						prompt: 'Set ' + settingName,
						value: oldBuffer!.toString().replace(/\r\n/g, '\\n'),
					});
					if (newValue) {
						stat.settings.set(settingName, Buffer.from(newValue.replace(/\\n/g, '\r\n')));
						// TODO: consider moving cookie to PloneObject instance
						if (!cookie) {
							cookie = ploneFS.getCookie(uri);
						}
						stat.saveSetting(settingName, cookie);
					}
				}
			}

			context.subscriptions.push(vscode.commands.registerCommand(
				'plonefs.editTitle',
				uri => setSetting(uri, 'title'),
			));

			context.subscriptions.push(vscode.commands.registerCommand(
				'plonefs.editDescription',
				uri => setSetting(uri, 'description'),
			));

			// special feature for UofL localcss plugin
			if (Object.keys(cookies).some(siteName => /^[^/]*louisville.edu/.test(siteName))) {
				context.subscriptions.push(vscode.commands.registerCommand(
					'plonefs.editLocalCss',
					async (uri: vscode.Uri) => {
						const entry = await ploneFS.stat(uri);
						// I don't know of a way to make the context menu option not show up on some items
						if (!entry.hasLocalCss) {
							vscode.window.showErrorMessage('no local css');
						}
						else if (entry instanceof Folder) {
							vscode.window.showTextDocument(uri.with({ path: uri.path + '/local.css', query: 'localCss' }));
						}
						else if (entry instanceof Document) {
							vscode.window.showTextDocument(uri.with({ path: uri.path + '.local.css', query: 'localCss' }));
						}
					},
				));
			}
		}
	}

	async function login(uri: vscode.Uri): Promise<string | undefined> {
		const siteName = getSiteName(uri);
		const cookieStore = context.globalState.get<CookieStore>(cookieStoreName, {});
		// check old cookie
		const testCookie = cookieStore[siteName];
		if (typeof testCookie === 'string' && await PloneFS.checkCookie(uri, testCookie)) {
			return testCookie;
		}
		// no cookie or too old
		delete cookieStore[siteName];
		context.globalState.update(cookieStoreName, cookieStore);

		// get cookie with username/password
		let cookie: string | undefined,
			username: string | undefined = '',
			password: string | undefined = '';
		while (true) {
			username = await vscode.window.showInputBox({
				prompt: 'Username for ' + siteName,
				value: username,
			});
			// cancelled
			if (username === undefined) {
				return;
			}
			password = await vscode.window.showInputBox({
				prompt: 'Password for ' + siteName,
				value: password,
				password: true,
			});
			// cancelled
			if (password === undefined) {
				return;
			}

			try {
				cookie = await PloneFS.login(uri, { username, password });
				cookieStore[siteName] = cookie;
				context.globalState.update(cookieStoreName, cookieStore);
				return cookie;
			}
			catch (e) {
				vscode.window.showErrorMessage('login failed');
			}
		}
	}

	context.subscriptions.push(vscode.commands.registerCommand('plonefs.workspace', async () => {
		let uri: vscode.Uri | undefined, cookie: string | undefined;
		while (!cookie) {
			const items = [...Object.keys(context.globalState.get<CookieStore>(cookieStoreName, {})), 'new'];
			const pick = await vscode.window.showQuickPick(items, {
				placeHolder: 'Open Plone site',
				canPickMany: false,
			});
			// cancelled
			if (pick === undefined) {
				return;
			}
			let uriValue = pick !== 'new' ? pick : await vscode.window.showInputBox({
				prompt: 'Open new Plone site',
				placeHolder: 'example.com/sitename',
			});
			// cancelled
			if (uriValue === undefined) {
				return;
			}
			// remove a final slash
			uriValue = uriValue.replace(/\/+$/, '');
			uri = vscode.Uri.parse('plone://' + uriValue);
			if (uri) {
				vscode.workspace.updateWorkspaceFolders(
					0, 0, {
						name: getSiteName(uri),
						uri,
					},
				);
			}
		}
	}));
}

function getSiteName(uri: vscode.Uri): string {
	return uri.authority + uri.path;
}