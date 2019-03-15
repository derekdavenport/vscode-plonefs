import * as vscode from 'vscode';
import { Page, NewsItem, File, LocalCss, Entry, Event, Topic, State, WithState, WithLocalCss, WithPortlets, PortletManagers, PortletManager, BaseFolder, PloneObjectOptions, StateAction } from '.';
import * as Form from 'form-data';

interface FolderOptions extends PloneObjectOptions {
	isRoot?: boolean;
}

type Listing = {
	parent_url: string;
	path: Item[];
	upload_allowed: boolean;
	items: Item[];
};

type Item = {
	description: string;
	uid: string;
	title: string;
	url: string;
	is_folderish: boolean;
	review_state: State | null;
	icon: string;
	portal_type: 'Folder' | 'Document' | 'News Item' | 'Event' | 'Topic';
	id: string;
	normalized_type: 'folder' | 'document' | 'news-item' | 'event' | 'topic' | 'file';
};

export default class Folder extends BaseFolder implements WithState, WithLocalCss, WithPortlets {
	entries: Map<string, Entry>;
	private _isRoot!: boolean;
	get isRoot() {
		return this._isRoot;
	}
	set isRoot(isRoot: boolean) {
		this._isRoot = isRoot;
		if (this.localCss) {
			this.localCss.forRoot = isRoot;
		}
	}

	portletManagers: PortletManagers;

	state: State;
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;

	constructor(options: FolderOptions) {
		super(options);

		this.state = 'internal';
		const { isRoot, uri } = options;
		this.isRoot = isRoot || false;
		// special feature for UofL localcss plugin
		this.hasLocalCss = uri.authority.endsWith('louisville.edu');
		if (this.hasLocalCss) {
			this.localCss = new LocalCss({ ...options, forRoot: isRoot });
		}
		this.type = vscode.FileType.Directory;
		this.entries = new Map<string, Entry>();
		this.portletManagers = {
			top:    new PortletManager({ client: this.client, parentUri: this.uri, side: 'top' }),
			right:  new PortletManager({ client: this.client, parentUri: this.uri, side: 'right' }),
			bottom: new PortletManager({ client: this.client, parentUri: this.uri, side: 'bottom' }),
			left:   new PortletManager({ client: this.client, parentUri: this.uri, side: 'left' }),
		};
	}

	relativizePath(path: string) {
		if (path.indexOf(this.uri.path) !== 0) {
			throw new Error('path is not relative to this folder')
		}
		return path.substring(this.uri.path.length);
	}

	changeState(stateAction: StateAction) {
		return this._changeState(stateAction);
	}

	saveSetting(settingName: string): Promise<boolean> {
		if (this.isRoot) {
			throw vscode.FileSystemError.Unavailable('cannot edit root folder');
		}
		return super.saveSetting(settingName);
		// TODO: title and description at the root require an authenticator
		// not worth the trouble right now
	}

	loadDetails(): Promise<void> {
		if (this.isRoot) {
			throw vscode.FileSystemError.Unavailable('cannot load details for root folder');
		}
		return super.loadDetails();
	}


	protected async _load(): Promise<void> {
		this.loaded = false;
		this.isRoot ? await this._loadRoot() : await this._loadExternal();
		this.loading = false;
		this.loaded = true;
	}

	private _loadRoot(): boolean {
		throw vscode.FileSystemError.Unavailable('loading root folder not implemented');
		this.client(this.uri.path + '/@@site-controlpanel');
	}

	private async _loadExternal(): Promise<void> {
		const buffer = await this._loadExternalBuffer();
		this.parseExternalEdit(buffer);
	}

	protected async _loadEntries(): Promise<void> {
		this.loadedEntries = false;
		const classes = {
			folder: Folder,
			document: Page,
			'news-item': NewsItem,
			event: Event,
			topic: Topic,
			file: File,
		};
		const body = new Form();
		body.append('rooted', 'False');
		body.append('document_base_url', 'https://' + this.uri.authority + this.uri.path + '/',);
		const response = await this.client.post(this.uri.path + '/tinymce-jsonlinkablefolderlisting', { body, encoding: 'utf8' });
		this.loadingEntries = false;
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable('could not load folder entries.\n' + response.statusCode + ': ' + response.statusMessage);
		}
		const json: Listing = JSON.parse(response.body);
		this.entries.clear();
		//this.settings.set('title', Buffer.from(json.path[json.path.length-1].title));
		// json.path[0] // TODO: check if really root?
		// json.upload_allowed // TODO: check this to know if can save?
		for (const item of json.items) {
			if (item.normalized_type in classes) {
				const entry = new classes[item.normalized_type]({ client: this.client, uri: vscode.Uri.parse(item.url).with({ scheme: 'plone' }), exists: true });
				entry.state = item.review_state;
				entry.title = item.title;
				entry.description = item.description;
				this.entries.set(item.id, entry);
			}
		}
		this.loadedEntries = true;
	}

	async paste(): Promise<void> {
		const response = await this.client(this.uri.path + '/object_paste');
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
	}
}