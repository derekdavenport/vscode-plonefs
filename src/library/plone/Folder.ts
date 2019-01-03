import * as vscode from 'vscode';
import { PloneObject, Document, File, LocalCss, Entry } from '.';
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
	review_state: boolean;
	icon: string;
	portal_type: 'Folder' | 'Document';
	id: string;
	normalized_type: 'folder' | 'document' | 'file';
};

export default class Folder extends PloneObject {
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

	constructor(uri: vscode.Uri, exists = false, isRoot = false) {
		super(uri, exists);

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
		if (!this.isRoot) {
			return super.saveSetting(settingName, cookie);
		}
		throw vscode.FileSystemError.Unavailable('cannot edit root folder');
		// TODO: title and description at the root require an authenticator
		// not worth the trouble right now
		// switch (settingName) {
		// 	case 'title':
		// 		break;
		// 	case 'description':
		// 		break;
		// }
	}

	load(cookie: Cookie): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	loadEntries(cookie: Cookie): Promise<boolean> {
		if (this.loadingEntries) {
			return this.loadingEntriesPromise;
		}
		this.loadingEntries = true;
		return this.loadingEntriesPromise = this._loadEntries(cookie);
	}

	private async _load(cookie: Cookie): Promise<boolean> {
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
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: externalEditPath,
			headers: { cookie },
		});
		if (response.statusCode !== 200) {
			this.loading = false;
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		this.parseExternalEdit(buffer);
		return true;
	}

	private async _loadEntries(cookie: Cookie): Promise<boolean> {
		this.loadedEntries = false;
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
			switch (item.normalized_type) {
				case 'folder':
					this.entries.set(item.id, new Folder(vscode.Uri.parse(item.url), true));
					break;
				case 'document':
					this.entries.set(item.id, new Document(vscode.Uri.parse(item.url), true));
					break;
				case 'file':
					this.entries.set(item.id, new File(vscode.Uri.parse(item.url), true));
					break;
			}
		}
		this.loadingEntries = false;
		return this.loadedEntries = true;
	}
}