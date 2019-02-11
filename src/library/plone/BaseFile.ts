'use strict';
import * as vscode from 'vscode';
import { PloneObject } from ".";
import { post, getBuffer, get } from '../util';
import { RequestOptions } from 'https';

export default abstract class BaseFile extends PloneObject {
	data: Uint8Array;
	static readonly fieldname: string;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.File;
		this.data = Buffer.from('');
	}

	async save(cookie: string): Promise<boolean> {
		// if doesn't exist or a rename, need full save
		if (!this.exists || this.path.base !== this.name) {
			return super.save(cookie);
		}
		// this is a quick save
		// TODO: make tinymce save its own function so code not duplicated in saveSetting
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/tinymce-save',
			headers: { cookie },
		};
		const postData = {
			fieldname: (this.constructor as typeof BaseFile).fieldname,
			text: this.data.toString(), // TODO: support buffer?
		};
		const response = await post(options, postData);
		const buffer = await getBuffer(response);
		return this.exists = buffer.equals(BaseFile.savedText);
	}

	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	protected async _load(cookie: string): Promise<boolean> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: externalEditPath,
			headers: { cookie },
		});
		if (response.statusCode === 302) {
			this.loading = false;
			throw vscode.FileSystemError.NoPermissions(this.uri);
		}
		else if (response.statusCode !== 200) {
			this.loading = false;
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		this.data = this.parseExternalEdit(buffer);
		return this.loaded = true;
	}
}