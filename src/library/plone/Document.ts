import * as vscode from 'vscode';
import { get, getBuffer } from '../util';
import { BaseFile, LocalCss } from '.';

export default class Document extends BaseFile {
	static readonly fieldname = 'text';

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		// special feature for UofL localcss plugin
		this.hasLocalCss = uri.authority.endsWith('louisville.edu');
		if (this.hasLocalCss) {
			this.localCss = new LocalCss(uri);
		}
	}
	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	private async _load(cookie: string): Promise<boolean> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: externalEditPath,
			headers: { cookie },
		});
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		this.data = this.parseExternalEdit(buffer);
		return this.loaded = true;
	}
}