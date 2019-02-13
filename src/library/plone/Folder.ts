import * as vscode from 'vscode';
import { PloneObject, Page, NewsItem, File, LocalCss, Entry, Event, Topic, State, WithState, WithLocalCss } from '.';
import { post, getBuffer, get } from '../util';
import { RequestOptions } from 'https';
import { Cookie } from '../../PloneFS';

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

export default class Folder extends PloneObject implements WithState, WithLocalCss {
	entries: Map<string, Entry>;
	loadingEntries: boolean;
	loadingEntriesPromise: Promise<boolean>;
	loadedEntries: boolean;
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

	state: State;
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;

	constructor(uri: vscode.Uri, exists = false, isRoot = false) {
		super(uri, exists);

		this.state = 'internal';

		this.loadingEntries = false;
		this.loadedEntries = false;
		this.loadingEntriesPromise = Promise.resolve(false);

		this.isRoot = isRoot;
		// special feature for UofL localcss plugin
		this.hasLocalCss = uri.authority.endsWith('louisville.edu');
		if (this.hasLocalCss) {
			this.localCss = new LocalCss(uri, isRoot);
		}
		this.type = vscode.FileType.Directory;
		this.entries = new Map<string, Entry>();
	}

	async saveSetting(settingName: string, cookie: string): Promise<boolean> {
		if (this.isRoot) {
			throw vscode.FileSystemError.Unavailable('cannot edit root folder');
		}
		return super.saveSetting(settingName, cookie);
		
		// TODO: title and description at the root require an authenticator
		// not worth the trouble right now
		// switch (settingName) {
		// 	case 'title':
		// 		break;
		// 	case 'description':
		// 		break;
		// }
	}

	loadEntries(cookie: Cookie): Promise<boolean> {
		if (this.loadingEntries) {
			return this.loadingEntriesPromise;
		}
		this.loadingEntries = true;
		return this.loadingEntriesPromise = this._loadEntries(cookie);
	}

	protected async _load(cookie: Cookie): Promise<boolean> {
		this.loaded = false;
		this.isRoot ? await this._loadRoot(cookie) : await this._loadExternal(cookie);
		this.loading = false;
		return this.loaded = true;
	}

	private _loadRoot(cookie: Cookie): boolean {
		throw vscode.FileSystemError.Unavailable('loading root folder not implemented');
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/@@site-controlpanel',
			headers: { cookie },
		};
		get(options);
	}

	private async _loadExternal(cookie: Cookie): Promise<boolean> {
		const buffer = await this._loadExternalBuffer(cookie);
		this.parseExternalEdit(buffer);
		return true;
	}

	private async _loadEntries(cookie: Cookie): Promise<boolean> {
		this.loadedEntries = false;
		const classes = {
			'folder': Folder,
			'document': Page,
			'news-item': NewsItem,
			'event': Event,
			'topic': Topic,
			'file': File,
		}
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/tinymce-jsonlinkablefolderlisting',
			headers: { cookie },
		};
		const response = await post(options, {
			rooted: 'False',
			document_base_url: 'https://' + this.uri.authority + this.uri.path + '/',
		});
		const buffer = await getBuffer(response);
		const json: Listing = JSON.parse(buffer.toString());
		//this.settings.set('title', Buffer.from(json.path[json.path.length-1].title));
		// json.path[0] // TODO: check if really root?
		// json.upload_allowed // TODO: check this to know if can save?
		for (const item of json.items) {
			if (item.normalized_type in classes) {
				const entry = new classes[item.normalized_type](vscode.Uri.parse(item.url).with({ scheme: 'plone' }), true);
				entry.state = item.review_state;
				entry.description = item.description;
				this.entries.set(item.id, entry);
			}
		}
		this.loadingEntries = false;
		return this.loadedEntries = true;
	}

	async paste(cookie: Cookie): Promise<void> {
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/object_paste',
			headers: { cookie },
		};
		const response = await get(options);
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
	}
}