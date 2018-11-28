import * as vscode from 'vscode';
import * as https from 'https';
import * as querystring from 'querystring';
import PloneObject from './PloneObject';
import Document from './Document';
import File from './File';
import { Entry } from '.';

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
		this.entries = new Map();
	}

	async load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = new Promise<boolean>((resolve, reject) => {
			this.loaded = false;
			const postData = querystring.stringify({
				rooted: 'True',
				document_base_url: '/',
			});
			const options = {
				method: 'POST',
				host: this.uri.authority,
				path: this.uri.path + '/tinymce-jsonlinkablefolderlisting',
				headers: {
					"Cookie": cookie,
					"Content-Type": "application/x-www-form-urlencoded;  charset=UTF-8",
					"Content-Length": Buffer.byteLength(postData)
				},
			};

			const request = https.request(options, response => {
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) =>
					buffers.push(chunk))
					;
				response.on('end', () => {
					//const buffer = Buffer.from(data);
					//const string = buffer.toString();
					const json: Listing = JSON.parse(Buffer.concat(buffers).toString());
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
					resolve(this.loaded = true);
				});
			});
			request.on('error', error => {
				this.loading = false;
				reject(error);
			});
			request.end(postData);
		});
	}
}