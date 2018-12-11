'use strict';
import * as vscode from 'vscode';
import { PloneObject } from ".";
import { post, getBuffer } from '../util';
import { RequestOptions } from 'https';

export default abstract class BaseFile extends PloneObject {
	data: Uint8Array;
	static readonly savedText = Buffer.from('saved');
	static readonly fieldname: string;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.File;
		this.data = Buffer.from('');
	}

	async save(cookie: string): Promise<boolean> {
		if (!this.exists) {
			return super.save(cookie);
		}
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/tinymce-save',
			headers: { cookie },
		};
		const postData = {
			fieldname: (this.constructor as typeof BaseFile).fieldname,
			text: this.data.toString(), // TODO: support buffer
		};
		const response = await post(options, postData);
		const buffer = await getBuffer(response);
		return this.exists = buffer.equals(BaseFile.savedText);
	}
}