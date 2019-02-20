'use strict';
import * as vscode from 'vscode';
import PloneFS, { CookieStore } from './PloneFS';
import { Page, File, LocalCss, Folder, Entry, Document, isWithState, isWithLocalCss, StateText, TextState } from './library/plone';
import { copyMatch, get, getBuffer } from './library/util';

const cookieStoreName = 'cookieStore';

enum StateActions {
	'Internal draft' = 'show_internally',
	'Externally visible' = 'publish_externally',
	'Internally published' = 'publish_internally',
	'Internally restricted' = 'publish_restricted',
	'Private' = 'hide',
	'Pending review' = 'submit'
};
enum StateColor {
	internal = 'white',
	external = '#74AE0B',
	internally_published = 'white',
	internally_restricted = 'white',
	private = 'red',
	pending = '#FFA500',
}
enum Options {
	title,
	description,
	setState,
	checkOut,
	cancelCheckOut,
	checkIn,
	openLocalCSS,
};
interface SetSettingAction {
	type: Options.title | Options.description,
	entry: Entry,
}
interface SetStateAction {
	type: Options.setState,
	entry: Folder | Document,
}
interface CheckOutAction {
	type: Options.checkOut,
	entry: Page,
}
interface CancelCheckOutAction {
	type: Options.cancelCheckOut,
	entry: Page,
}
interface CheckInAction {
	type: Options.checkIn,
	entry: Page,
}
interface OpenLocalCssAction {
	type: Options.openLocalCSS,
	entry: Folder | Document,
}
type OptionsMenuAction = SetSettingAction | SetStateAction | CheckOutAction | CancelCheckOutAction | CheckInAction | OpenLocalCssAction;


export async function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders !== undefined) {
		let cookies: CookieStore = {};
		for (const folder of vscode.workspace.workspaceFolders) {
			if (folder.uri.scheme === 'plone') {
				const cookie = await login(folder.uri);
				if (cookie === undefined) {
					vscode.window.showInformationMessage('login cancelled');
				}
				else {
					cookies[getSiteName(folder.uri)] = cookie;
				}
			}
		}
		if (Object.keys(cookies).length) {
			const ploneFS = new PloneFS(cookies);
			context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFS, { isCaseSensitive: false }));

			const stateStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
			stateStatus.command = 'plonefs.changeState';
			stateStatus.tooltip = 'Change state';

			async function showChangeState(entry: Folder | Document) {
				const stateText = await vscode.window.showQuickPick(Object.keys(StateActions), {
					placeHolder: 'Choose State',
					canPickMany: false,
				}) as keyof typeof StateActions | undefined;
				if (stateText && stateText !== StateText[entry.state!]) {
					const cookie = ploneFS.getRoot(entry.uri).cookie;
					const response = await get({
						host: entry.uri.authority,
						path: entry.uri.path + '/content_status_modify?workflow_action=' + StateActions[stateText],
						headers: { cookie },
					});
					if (response.statusCode === 302) {
						entry.state = TextState[stateText];
						// make sure this is still the active document
						if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri === entry.uri) {
							setStateStatus(entry);
						}
					}
					else {
						vscode.window.showErrorMessage(`Unable to set state to "${stateText}"\n${response.statusCode}: ${response.statusMessage}`);
					}
				}
			}

			function setStateStatus(entry: Folder | Document) {
				stateStatus.text = 'State: ' + StateText[entry.state!];
				stateStatus.color = StateColor[entry.state!];
				stateStatus.show();
			}

			context.subscriptions.push(
				vscode.commands.registerCommand(
					'plonefs.changeState',
					async () => {
						if (!vscode.window.activeTextEditor) {
							return stateStatus.hide();
						}
						const entry: Entry = await ploneFS.stat(vscode.window.activeTextEditor.document.uri);
						if (isWithState(entry)) {
							showChangeState(entry);
						}
						else {
							stateStatus.hide();
						}
					},
				)
			);

			const titleStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1001);
			titleStatus.command = 'plonefs.changeTitle';
			titleStatus.tooltip = 'Change title';

			function setTitleStatus(entry: Entry) {
				titleStatus.text = 'Title: ' + entry.title;
				titleStatus.show();
			}

			context.subscriptions.push(
				vscode.commands.registerCommand(
					'plonefs.changeTitle',
					async () => {
						if (!vscode.window.activeTextEditor) {
							return titleStatus.hide();
						}
						const entry: Entry = await ploneFS.stat(vscode.window.activeTextEditor.document.uri);
						setSetting(entry, 'title');
					},
				)
			);

			// to VS Code Plone Documents and Plone Files are both TextDocuments
			// so set Plone Documents to be HTML and Files to be whatever we determined them to be
			// (unless VS Code already figured it out)
			context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(async doc => {
				const entry: Entry = await ploneFS.stat(doc.uri);
				if (doc.languageId === 'plaintext') {
					if (entry instanceof Document) {
						vscode.languages.setTextDocumentLanguage(doc, 'html');
					}
					else if (entry instanceof LocalCss) {
						vscode.languages.setTextDocumentLanguage(doc, 'css');
					}
					else if (entry instanceof File && entry.language && entry.language !== 'plaintext') {
						vscode.languages.setTextDocumentLanguage(doc, entry.language);
					}
				}
			}));

			context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (textEditor?: vscode.TextEditor) => {
				if (textEditor) {
					const entry: Entry = await ploneFS.stat(textEditor.document.uri);
					if (isWithState(entry)) {
						setStateStatus(entry);
					}
					else {
						stateStatus.hide();
					}
					setTitleStatus(entry);
				}
				else {
					stateStatus.hide();
					titleStatus.hide();
				}
			}));

			async function setSetting(entry: Entry, settingName: 'title' | 'description') {
				const oldValue = entry[settingName];
				const singleLineValue = await vscode.window.showInputBox({
					prompt: 'Set ' + settingName,
					// currently vscode only allows single-line input
					value: oldValue.replace(/\r\n/g, '\\n'),
					ignoreFocusOut: false,
				});
				// cancelled
				if (singleLineValue === undefined) {
					return;
				}
				// convert single-line input to multi-line
				const newValue = singleLineValue.replace(/\\n/g, '\r\n')
				entry[settingName] = newValue;
				entry.settings.set(settingName, Buffer.from(newValue));
				// TODO: consider moving cookie to PloneObject instance
				const cookie = ploneFS.getRoot(entry.uri).cookie;
				const success = await entry.saveSetting(settingName, cookie);
				if (success) {
					vscode.window.showInformationMessage(`Set ${settingName}: ${singleLineValue}`);
					if (settingName === 'title') {
						setTitleStatus(entry);
					}
				}
			}

			async function optionsMenu(uri: vscode.Uri): Promise<void> {
				const entry = await ploneFS.stat(uri);
				const cookie = ploneFS.getRoot(entry.uri).cookie;
				await entry.loadDetails(cookie);
				// map readable text to pick option
				const optionsToAction: { [option: string]: OptionsMenuAction } = {};
				// disable title/description for root until supported
				if (!(entry instanceof Folder && entry.isRoot)) {
					optionsToAction['Title: ' + entry.title] = { type: Options.title, entry };
					// TODO: support file description
					//if (!(entry instanceof File)) {
					optionsToAction['Description: ' + entry.description] = { type: Options.description, entry };
					//}
				}
				if (isWithState(entry)) {
					optionsToAction['State: ' + StateText[entry.state]] = { type: Options.setState, entry };
				}

				if (entry instanceof Page) {
					const match = copyMatch(entry.name);
					let isWorkingCopy = false;
					if (match) {
						const response = await get({
							host: entry.uri.authority,
							path: entry.uri.path + '/@@iterate_control/checkin_allowed',
							headers: { cookie },
						});
						const buffer = await getBuffer(response);
						if (buffer.equals(Buffer.from('True'))) {
							optionsToAction['Check In'] = { type: Options.checkIn, entry };
							optionsToAction['Cancel Check In'] = { type: Options.cancelCheckOut, entry };
							isWorkingCopy = true;
						}
					}
					if (!isWorkingCopy) {
						optionsToAction['Check Out'] = { type: Options.checkOut, entry };
					}
				}
				if (isWithLocalCss(entry) && entry.hasLocalCss) {
					optionsToAction['Open Local CSS'] = { type: Options.openLocalCSS, entry };
				}
				const option = await vscode.window.showQuickPick(Object.keys(optionsToAction), {
					placeHolder: 'Plone Options',
					canPickMany: false,
					ignoreFocusOut: false,
				});
				// cancelled
				if (option === undefined) {
					return;
				}
				optionsReducer(optionsToAction[option]);
			}

			async function optionsReducer(action: OptionsMenuAction) {
				switch (action.type) {
					case Options.title:
						setSetting(action.entry, 'title');
						break;
					case Options.description:
						setSetting(action.entry, 'description');
						break;
					case Options.checkOut:
						let tryCheckOut: string | undefined = 'try again';
						while (tryCheckOut) {
							try {
								tryCheckOut = await ploneFS.checkOut(action.entry);
							}
							catch (error) {
								tryCheckOut = await vscode.window.showErrorMessage('Unable to check out. It may already be checked out\n' + error.message, 'try again');
							}
						}
						break;
					case Options.checkIn:
						let tryCheckin: string | undefined = 'try again';
						let message: string | undefined;
						while (tryCheckin) {
							try {
								message = await vscode.window.showInputBox({
									prompt: 'Check-in Message',
									value: message,
									ignoreFocusOut: true,
								});
								if (message === undefined) {
									tryCheckin = await vscode.window.showInformationMessage('Cancelled Check-in', 'try again');
								}
								else {
									tryCheckin = await ploneFS.checkIn(action.entry, message);
								}
							}
							catch (error) {
								tryCheckin = await vscode.window.showErrorMessage('Unable to check in.\n' + error.message, 'try again');
							}
						}
						break;
					case Options.cancelCheckOut:
						ploneFS.cancelCheckOut(action.entry);
						break;
					case Options.setState:
						showChangeState(action.entry);
						break;
					case Options.openLocalCSS:
						const uri = action.entry.uri;
						if (action.entry instanceof Folder) {
							vscode.window.showTextDocument(uri.with({ path: uri.path + '/local.css', query: 'localCss' }));
						}
						else {
							vscode.window.showTextDocument(uri.with({ path: uri.path + '.local.css', query: 'localCss' }));
						}
						break;
					default:
						const never: never = action;
						throw new Error('unexpected Plone setting: ' + never);
				}
			}

			context.subscriptions.push(vscode.commands.registerCommand(
				'plonefs.editSettings',
				(uri: vscode.Uri) => optionsMenu(uri),
			));
			context.subscriptions.push(vscode.commands.registerCommand(
				'plonefs.debug.expireCookie',
				() => ploneFS._debug_expireCookies()
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
		let uri: vscode.Uri | undefined;
		while (!uri) {
			const newUriOption = '＋ new';
			const items = [...Object.keys(context.globalState.get<CookieStore>(cookieStoreName, {})).sort(), newUriOption];
			const pick = await vscode.window.showQuickPick(items, {
				placeHolder: 'Open Plone site',
				canPickMany: false,
				ignoreFocusOut: true,
			});
			// cancelled
			if (pick === undefined) {
				return;
			}
			let uriValue = pick !== newUriOption ? pick : await vscode.window.showInputBox({
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