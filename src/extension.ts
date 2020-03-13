'use strict';
import * as vscode from 'vscode';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
//import * as src from 'ssl-root-cas';
import * as got from 'got';
import { CookieJar, Cookie } from 'tough-cookie';
import PloneFS from './PloneFS';
import { Page, File, LocalCss, Folder, Entry, Document, Portlet, isWithState, isWithLocalCss, StateText, WithPortlets, WithState, WithLocalCss, isWithPortlets, PortletSides, PortletManager, stateActions } from './library/plone';

/* cert seems to be working for now
import { globalAgent } from 'https';
import { readFileSync } from 'fs';
import stage_louisville_edu_intermediate_cert from '../ssl/globalsign-org.cer';

// add missing intermediate cert for stage.louisville.edu
let ca = globalAgent.options.ca || [];
if (!(ca instanceof Array)) {
	ca = [ca];
}
ca.push(readFileSync(__dirname + '/' + stage_louisville_edu_intermediate_cert));
globalAgent.options.ca = ca;
*/

// add missing got declarations
declare module 'got' {
	interface MyGotStreamFn extends GotStreamFn {
		(url: GotUrl, options?: GotFormOptions<string | null>): GotEmitter & Duplex;
		(url: GotUrl, options?: GotBodyOptions<string | null>): GotEmitter & Duplex;
	}
	interface GotFn<T extends string | null = string> {
		(url: GotUrl): GotPromise<T extends string ? string : Buffer>;
		(url: GotUrl, options: GotJSONOptions): GotPromise<any>;
		(url: GotUrl, options: GotFormOptions<T>): GotPromise<T extends string ? string : Buffer>;
		(url: GotUrl, options: GotBodyOptions<T>): GotPromise<T extends string ? string : Buffer>;
	}
	interface GotExtend {
		(options: GotBodyOptions<null>): MyGotInstance<null>;
	}

	interface MyGotInstance<T extends string | null> extends GotFn<T>, Record<'get' | 'post' | 'put' | 'patch' | 'head' | 'delete', GotFn<T>> {
		stream: MyGotStreamFn & Record<'get' | 'post' | 'put' | 'patch' | 'head' | 'delete', MyGotStreamFn>;
	}
}

// declare module 'got' {
// 	type FixedGotStreamFn = (url: GotUrl, options?: GotOptions<string | null> | GotFormOptions<string | null>) => GotEmitter & Duplex;
// 	interface GotFn<E extends string | null = null> extends Record<'get' | 'post' | 'put' | 'patch' | 'head' | 'delete', got.GotFn<E>> {
// 		(url: GotUrl): GotPromise<E extends string ? string : Buffer>;
// 		(url: GotUrl, options: GotJSONOptions): GotPromise<any>;
// 		(url: GotUrl, options: GotFormOptions<E>): GotPromise<E extends string ? string : Buffer>;
// 		(url: GotUrl, options: GotBodyOptions<E>): GotPromise<E extends string ? string : Buffer>;
// 		extend(options: GotJSONOptions): GotFn<string>;
// 		extend(options: GotFormOptions<E>): GotFn<E>;
// 		extend(options: GotBodyOptions<E>): GotFn<E>;
// 		stream: FixedGotStreamFn & Record<'get' | 'post' | 'put' | 'patch' | 'head' | 'delete', FixedGotStreamFn>;
// 	}
// }

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
	portlets,
	showUID,
}
interface SetSettingAction {
	type: Options.title | Options.description;
	entry: Entry;
}
interface SetStateAction {
	type: Options.setState;
	entry: WithState;
}
interface CheckOutAction {
	type: Options.checkOut;
	entry: Page;
}
interface CancelCheckOutAction {
	type: Options.cancelCheckOut;
	entry: Page;
}
interface CheckInAction {
	type: Options.checkIn;
	entry: Page;
}
interface OpenLocalCssAction {
	type: Options.openLocalCSS;
	entry: WithLocalCss;
}
interface PortletsAction {
	type: Options.portlets;
	entry: WithPortlets;
}
interface ShowUIDAction {
	type: Options.showUID;
	entry: Entry;
}
type OptionsMenuAction = SetSettingAction | SetStateAction | CheckOutAction | CancelCheckOutAction | CheckInAction | OpenLocalCssAction | PortletsAction | ShowUIDAction;

export type Roots = { [siteName: string]: Folder; };
type CookieJarStore = { [siteName: string]: CookieJar.Serialized };

const cookieStoreName = 'cookieStore';

const ploneFS = new PloneFS();

// activate is called when the extension first loads, but also when the first workspace folder is updated
// so don't do anything until at least one Plone folder is added
export async function activate(context: vscode.ExtensionContext) {
	function addFolders(folders: readonly vscode.WorkspaceFolder[]) {
		const cookieJarStore = context.globalState.get<CookieJarStore>(cookieStoreName, {});
		for (const folder of folders) {
			const siteName = getSiteName(folder.uri);
			const serializedJar = cookieJarStore[siteName];
			let cookieJar: CookieJar;
			if (serializedJar) {
				try {
					cookieJar = CookieJar.deserializeSync(cookieJarStore[siteName]);
				}
				catch (e) {
					cookieJar = new CookieJar();
				}
			}
			else {
				cookieJar = new CookieJar();
			}
			const gotOptions: got.GotBodyOptions<null> = {
				encoding: null, // default to buffer
				followRedirect: false,
				baseUrl: 'https://' + folder.uri.authority,
				cookieJar,
				hooks: {
					afterResponse: [
						async (response, retry) => {
							if ( // Unauthorized
								response.headers['bobo-exception-type'] === "<class 'zExceptions.unauthorized.Unauthorized'>" ||
								response.headers['bobo-exception-type'] === "<class 'AccessControl.unauthorized.Unauthorized'>"
							) {
								const loggedin = await login(folder.uri, cookieJar);
								if (!loggedin) {
									removeWorkspaceFolder(folder.uri);
								}
								else {
									context.globalState.update(cookieStoreName, { ...cookieJarStore, [siteName]: cookieJar.serializeSync() });
									return retry({});
								}
							}
							return response;
						},
					],
				},
			};
			const client = got.extend(gotOptions);
			const uri = folder.uri.with({ scheme: 'plone' });
			ploneFS.addRoot(siteName, new Folder({ client, uri, exists: true, isRoot: true }));
		}
	}

	const ploneWorkspaceFolders = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'plone');
	if (ploneWorkspaceFolders !== undefined) {
		context.subscriptions.push(vscode.workspace.registerFileSystemProvider('plone', ploneFS, { isCaseSensitive: false }));
		addFolders(ploneWorkspaceFolders);
		context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(e => {
			addFolders(e.added);
			e.removed.forEach(folder => folder.uri.scheme === 'plone' && ploneFS.removeRoot(getSiteName(folder.uri)));
		}));

		const stateStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
		stateStatus.command = 'plonefs.changeState';
		stateStatus.tooltip = 'Change state';

		async function showChangeState(entry: WithState): Promise<void> {
			// externally published, internally published, internally restricted can only retract
			const stateActionPick = await vscode.window.showQuickPick(Object.keys(stateActions[entry.state]), {
				placeHolder: 'Choose State',
			});
			if (stateActionPick) {
				const stateAction = stateActions[entry.state][stateActionPick];
				try {
					await entry.changeState(stateAction);
				}
				catch (e) {
					vscode.window.showErrorMessage(`Unable to "${stateActionPick}"\n${e.message}`);
					return;
				}
				vscode.window.showInformationMessage(`Set state of ${entry.name}: ${StateText[entry.state]}`);
				// make sure this is still the active document
				if (vscode.window.activeTextEditor) {
					const activeUri = vscode.window.activeTextEditor.document.uri;
					const entryUri = entry.uri;
					if (
						activeUri.scheme === entryUri.scheme &&
						activeUri.authority === entryUri.authority &&
						activeUri.path === entryUri.path &&
						activeUri.query === entryUri.query
					) {
						setStateStatus(entry);
					}
				}
			}
		}

		async function showPortletSidePicker(entry: WithPortlets): Promise<void> {
			const side = await vscode.window.showQuickPick(Object.keys(PortletSides), {
				placeHolder: 'Pick Portlet Side',
			}) as keyof typeof PortletSides | undefined;
			if (!side) {
				return;
			}
			showPortlets(entry.portletManagers[side]);
		}

		async function showPortlets(portletManager: PortletManager): Promise<void> {
			await portletManager.loadEntries();
			const newPortletOption = '$(file-add) new';
			const pickMap = [...portletManager.entries.entries()].reduce((pickMap, [name, portlet]) => {
				pickMap[`${portlet.title} (${name})`] = name;
				return pickMap;
			}, {} as Record<string, string>);
			const pick = await vscode.window.showQuickPick([...Object.keys(pickMap), newPortletOption], {
				placeHolder: 'Pick Portlet',
			});
			if (!pick) {
				return;
			}
			let name: string | undefined;
			if (pick === newPortletOption) {
				const header = await vscode.window.showInputBox({ prompt: 'Portlet header' });
				if (header === undefined) {
					return;
				}
				await portletManager.add(header);
				return showPortlets(portletManager);
			}
			else {
				name = pickMap[pick];
			}
			const portlet = portletManager.entries.get(name);
			if (portlet) {
				try {
					await vscode.window.showTextDocument(portlet.uri);
				}
				catch (error) {
					vscode.window.showErrorMessage(error.message);
				}
			}
		}

		async function showUID(entry: Entry) {
			// right now uid should always have a value
			// because this function is only called by the options menu
			// which should always load details first
			if (!entry.uid) {
				await entry.loadDetails();
			}
			if (entry.uid) {
				const options = <const>['Copy'];
				const option = await vscode.window.showInformationMessage(entry.uid, ...options) as typeof options[number] | undefined;
				switch (option) {
					case 'Copy':
						vscode.env.clipboard.writeText(entry.uid);
						break;
				}
			}
			else {
				vscode.window.showErrorMessage('could not load UID');
			}
		}

		function setStateStatus(entry: WithState) {
			stateStatus.text = 'State: ' + StateText[entry.state];
			stateStatus.color = StateColor[entry.state];
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
			),
		);

		const titleStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1001);
		titleStatus.command = 'plonefs.changeTitle';
		titleStatus.tooltip = 'Change title';

		function setTitleStatus(entry: Entry) {
			const label = (entry instanceof Portlet) ? 'Header: ' : 'Title: ';
			titleStatus.text = label + entry.title;
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
			),
		);

		context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(textDocumentOpened));
		context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (textEditor?: vscode.TextEditor) => {
			if (textEditor) {
				const entry: Entry = await ploneFS.stat(textEditor.document.uri);
				if (isWithState(entry)) {
					setStateStatus(entry);
				}
				else {
					stateStatus.hide();
				}
				if (!(entry instanceof LocalCss)) {
					setTitleStatus(entry);
				}
				else {
					titleStatus.hide();
				}
			}
			else {
				stateStatus.hide();
				titleStatus.hide();
			}
		}));

		async function setSetting(entry: Entry, settingName: 'title' | 'description') {
			const oldValue = entry[settingName];
			const prompt = entry instanceof Portlet && settingName === 'title' ? 'Set header' : 'Set ' + settingName;
			const singleLineValue = await vscode.window.showInputBox({
				prompt,
				// currently vscode only allows single-line input
				value: oldValue.replace(/\r\n/g, '\\n'),
				ignoreFocusOut: false,
			});
			// cancelled
			if (singleLineValue === undefined) {
				return;
			}
			// convert single-line input to multi-line
			const newValue = singleLineValue.replace(/\\n/g, '\r\n');
			const success = await entry.saveSetting(settingName, newValue);
			if (success) {
				vscode.window.showInformationMessage(`Set ${settingName}: ${singleLineValue}`);
				if (settingName === 'title') {
					setTitleStatus(entry);
				}
			}
		}

		async function optionsMenu(uri: vscode.Uri): Promise<void> {
			const entry = await ploneFS.stat(uri);
			// map readable text to pick option
			const optionsToAction: { [option: string]: OptionsMenuAction } = {};
			// disable title/description for root until supported
			const isRootFolder = entry instanceof Folder && entry.isRoot;
			if (!isRootFolder) {
				await entry.loadDetails();
				optionsToAction['Title: ' + entry.title] = { type: Options.title, entry };
				optionsToAction['Description: ' + entry.description] = { type: Options.description, entry };

				// root folder does not have state
				if (isWithState(entry)) {
					optionsToAction['State: ' + StateText[entry.state]] = { type: Options.setState, entry };
				}
			}
			if (entry instanceof Page) {
				const canCheckInPromise = entry.canCheckIn();
				const canCheckOutPromise = entry.canCheckOut();
				if (await canCheckInPromise) {
					optionsToAction['Check In'] = { type: Options.checkIn, entry };
					optionsToAction['Cancel Check Out'] = { type: Options.cancelCheckOut, entry };
				}
				else if (await canCheckOutPromise) {
					optionsToAction['Check Out'] = { type: Options.checkOut, entry };
				}
			}
			if (isWithLocalCss(entry) && entry.hasLocalCss) {
				optionsToAction['Open Local CSS'] = { type: Options.openLocalCSS, entry };
			}
			if (isWithPortlets(entry)) {
				optionsToAction['Portlets'] = { type: Options.portlets, entry };
			}
			if (!isRootFolder) {
				optionsToAction['Get UID'] = { type: Options.showUID, entry };
			}
			const option = await vscode.window.showQuickPick(Object.keys(optionsToAction), {
				placeHolder: 'Plone Options',
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
							const copy = await ploneFS.checkOut(action.entry);
							vscode.window.showTextDocument(copy.uri);
							break;
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
						message = await vscode.window.showInputBox({
							prompt: 'Check-in Message',
							value: message,
							ignoreFocusOut: true,
						});
						if (message === undefined) {
							tryCheckin = await vscode.window.showInformationMessage('Cancelled Check-in', 'try again');
						}
						else {
							try {
								await ploneFS.checkIn(action.entry, message);
								tryCheckin = undefined;
							}
							catch (error) {
								tryCheckin = await vscode.window.showErrorMessage('Unable to check in.\n' + error.message, 'try again');
							}
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
					const separator = action.entry instanceof Folder ? '/' : '.';
					vscode.window.showTextDocument(uri.with({ path: `${uri.path}${separator}local.css`, query: 'localCss' }));
					break;
				case Options.portlets:
					showPortletSidePicker(action.entry);
					break;
				case Options.showUID:
					showUID(action.entry);
					break;
				default:
					const never: never = action;
					throw new Error('unexpected Plone setting: ' + never);
			}
		}

		context.subscriptions.push(vscode.commands.registerCommand(
			'plonefs.optionsMenu',
			(uri?: vscode.Uri) => {
				if (uri) {
					optionsMenu(uri);
				}
			},
		));
	}

	context.subscriptions.push(vscode.commands.registerCommand('plonefs.workspace', async () => {
		let uri: vscode.Uri | undefined;
		while (!uri) {
			const newUriOption = '$(new-folder) new';
			let items = [
				...Object.keys(context.globalState.get<CookieJarStore>(cookieStoreName, {})).sort(),
				newUriOption,
			];
			const openNames = vscode.workspace.workspaceFolders?.map(folder => folder.name);
			if (openNames) {
				items = items.filter(item => !openNames.includes(item));
			}
			const pick = await vscode.window.showQuickPick(items, {
				placeHolder: 'Open Plone site',
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

			// remove protocol and/or a final slash
			uriValue = uriValue.replace(/^https?:\/\/|\/+$/g, '');
			if (openNames?.includes(uriValue)) {
				vscode.window.showInformationMessage(`${uriValue} is already open`);
				continue;
			}
			uri = vscode.Uri.parse('plone://' + uriValue);
		}
		const cookieJarStore = context.globalState.get<CookieJarStore>(cookieStoreName, {});
		const siteName = getSiteName(uri);
		const serializedJar = cookieJarStore[siteName];
		let cookieJar: CookieJar;
		let loggedin = false;
		if (serializedJar) {
			try {
				cookieJar = CookieJar.deserializeSync(cookieJarStore[siteName]);
				const stream = await got.stream('https://' + uri.authority + uri.path + '/edit', {
					followRedirect: false,
					cookieJar,
				});
				const response = await getResponse(stream);
				loggedin = response.statusCode === 200;
			}
			catch (e) {
				cookieJar = new CookieJar();
			}
		}
		else {
			cookieJar = new CookieJar();
		}
		if (!loggedin) {
			loggedin = await login(uri, cookieJar);
			if (!loggedin) {
				// cancelled
				return;
			}
		}
		context.globalState.update(cookieStoreName, { ...cookieJarStore, [siteName]: cookieJar.serializeSync() });
		const start = vscode.workspace.workspaceFolders?.length || 0;
		vscode.workspace.updateWorkspaceFolders(
			start,
			0,
			{
				name: siteName,
				uri,
			},
		);
	}));
}

async function login(uri: vscode.Uri, cookieJar: CookieJar): Promise<boolean> {
	const siteName = getSiteName(uri);
	let username: string | undefined = '',
		password: string | undefined = '';
	while (true) {
		username = await vscode.window.showInputBox({
			prompt: 'Username for ' + siteName,
			value: username,
			ignoreFocusOut: true,
		});
		// cancelled
		if (username === undefined) {
			return false;
		}
		password = await vscode.window.showInputBox({
			prompt: 'Password for ' + siteName,
			value: password,
			password: true,
			ignoreFocusOut: true,
		});
		// cancelled
		if (password === undefined) {
			return false;
		}

		const body = {
			came_from: uri.path,
			__ac_name: username,
			__ac_password: password,
			'form.submitted': 1,
		};

		const stream = got.stream.post('https://' + uri.authority + uri.path + '/login_form', { form: true, body, throwHttpErrors: false, cookieJar });
		let response: IncomingMessage | undefined = undefined;
		try {
			response = await getResponse(stream);
		}
		catch (e) {
			// ssl error
			// allow manually supplying cookie
			if (e.code === "EPROTO") {
				let cookieValue = await vscode.window.showInputBox({
					prompt: 'Cookie for ' + siteName,
					ignoreFocusOut: true,
				});
				// cancelled
				if (cookieValue === undefined) {
					return false;
				}
				// remove wrapping quotes
				else if (cookieValue[0] === '"') {
					cookieValue = cookieValue.slice(1, -1);
				}
				const cookie = new Cookie({
					key: '__ac',
					value: cookieValue,
					domain: uri.authority,
					path: '/',
				});
				cookieJar.setCookieSync(cookie, uri.authority + uri.path!);
			}
		}
		if(response?.statusCode === 302) {
			return true;
		}
		vscode.window.showInformationMessage('Login failed');
	}
}

function getSiteName(uri: vscode.Uri): string {
	return uri.authority + uri.path;
}

function getResponse(stream: got.GotEmitter) {
	return new Promise<IncomingMessage>((resolve, reject) => {
		stream.on('response', response => resolve(response));
		stream.on('error', error => reject(error));
	});
}

// to VS Code Plone Documents and Plone Files are both TextDocuments
// so set Plone Documents to be HTML and Files to be whatever we determined them to be
// (unless VS Code already figured it out)
async function textDocumentOpened(doc: vscode.TextDocument) {
	if (doc.uri.scheme === 'plone') {
		const entry: Entry = await ploneFS.stat(doc.uri);
		if (doc.languageId === 'plaintext') {
			if (entry instanceof Document || entry instanceof Portlet) {
				vscode.languages.setTextDocumentLanguage(doc, 'html');
			}
			else if (entry instanceof LocalCss) {
				vscode.languages.setTextDocumentLanguage(doc, 'css');
			}
			else if (entry instanceof File && entry.language && entry.language !== 'plaintext') {
				vscode.languages.setTextDocumentLanguage(doc, entry.language);
			}
		}
	}
}

function removeWorkspaceFolder(uri: vscode.Uri) {
	// login canceled, remove folder
	const index = vscode.workspace.workspaceFolders?.findIndex(f => f.uri === uri);
	if (index) {
		vscode.workspace.updateWorkspaceFolders(index, 1);
	}
}