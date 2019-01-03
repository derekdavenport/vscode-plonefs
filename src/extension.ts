'use strict';
import * as vscode from 'vscode';
import PloneFS, { CookieStore, Cookie } from './PloneFS';
import { Document, File, PloneObject, LocalCss, Folder, Entry } from './library/plone';

const cookieStoreName = 'cookieStore';

export async function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders !== undefined) {
		let cookies: CookieStore = {};
		for (const folder of vscode.workspace.workspaceFolders) {
			if (folder.uri.scheme === 'plone') {
				const cookie = await login(folder.uri);
				if (cookie === undefined) {
					vscode.window.showErrorMessage('Unable to open site: login cancelled');
					return;
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

			async function setSetting(entry: Entry, settingName: string) {
				if (entry instanceof PloneObject) {
					let cookie: Cookie | undefined;
					if (!entry.loaded) {
						cookie = ploneFS.getCookie(entry.uri);
						await entry.load(cookie);
					}
					const oldBuffer = entry.settings.get(settingName);
					if (!oldBuffer) {
						vscode.window.showErrorMessage('Unable to load ' + settingName);
						throw vscode.FileSystemError.Unavailable('Unable to load ' + settingName);
					}
					const newValue = await vscode.window.showInputBox({
						prompt: 'Set ' + settingName,
						// currently vscode only allows single-line input
						value: oldBuffer.toString().replace(/\r\n/g, '\\n'),
						ignoreFocusOut: true,
					});
					// cancelled
					if (newValue === undefined) {
						return;
					}
					// convert single-line input to multi-line
					entry.settings.set(settingName, Buffer.from(newValue.replace(/\\n/g, '\r\n')));
					// TODO: consider moving cookie to PloneObject instance
					if (!cookie) {
						cookie = ploneFS.getCookie(entry.uri);
					}
					entry.saveSetting(settingName, cookie);

				}
			}

			async function settingsMenu(uri: vscode.Uri): Promise<void> {
				enum Picks {
					title = 'Edit Title',
					description = 'Edit Description',
					localCSS = 'Edit Local CSS',
				};
				let items: Picks[] = [Picks.title, Picks.description];
				const entry = await ploneFS.stat(uri);
				if (entry.hasLocalCss) {
					items.push(Picks.localCSS);
				}
				const pick = await vscode.window.showQuickPick(items, {
					placeHolder: 'More Plone Options',
					canPickMany: false,
					ignoreFocusOut: true,
				}) as Picks | undefined;
				// cancelled
				if (pick === undefined) {
					return;
				}
				switch (pick) {
					case Picks.title:
						setSetting(entry, 'title');
						break;
					case Picks.description:
						setSetting(entry, 'description');
						break;
					case Picks.localCSS:
						if (entry instanceof Folder) {
							vscode.window.showTextDocument(uri.with({ path: uri.path + '/local.css', query: 'localCss' }));
						}
						else if (entry instanceof Document) {
							vscode.window.showTextDocument(uri.with({ path: uri.path + '.local.css', query: 'localCss' }));
						}
						break;
					default:
						const never: never = pick;
						throw new Error('unexpected Plone setting: ' + never);
				}
			}

			context.subscriptions.push(vscode.commands.registerCommand(
				'plonefs.editSettings',
				(uri: vscode.Uri) => settingsMenu(uri),
			));
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
				ignoreFocusOut: true,
			});
			// cancelled
			if (username === undefined) {
				return;
			}
			password = await vscode.window.showInputBox({
				prompt: 'Password for ' + siteName,
				value: password,
				password: true,
				ignoreFocusOut: true,
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
				ignoreFocusOut: true,
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