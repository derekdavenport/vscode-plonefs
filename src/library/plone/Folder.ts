import * as vscode from 'vscode';
import PloneObject from './PloneObject';
import Document from './Document';
import File from './File';
import { Entry } from '.';
import { post, getBuffer } from '../util';

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

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.Directory;
		this.entries = new Map<string, Entry>();
	}

	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	private async _load(cookie: string): Promise<boolean> {
		this.loaded = false;
		const options = {
			host: this.uri.authority,
			path: Folder.escapePath(this.uri.path) + '/tinymce-jsonlinkablefolderlisting',
			headers: {
				'Cookie': cookie,
			},
		};
		const response = await post(options, {
			rooted: 'True',
			document_base_url: '/',
		});
		const buffer = await getBuffer(response);
		const json: Listing = JSON.parse(buffer.toString());
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
		this.loading = false;
		return this.loaded = true;
	}
}