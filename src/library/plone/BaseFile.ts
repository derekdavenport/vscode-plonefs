'use strict';
import * as vscode from 'vscode';
import { PloneObject } from ".";
import { escapePath, post, getBuffer } from '../util';

export default abstract class BaseFile extends PloneObject {
	data: Uint8Array;
	static readonly savedText = Buffer.from('saved');
	static readonly fieldname: string;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.File;
	}

	async save(cookie: string): Promise<boolean> {
		if (!this.exists) {
			return super.save(cookie);
		}
		const postData = {
			fieldname: this.constructor['fieldname'],
			text: this.data.toString(),
		};
		const options = {
			host: this.uri.authority,
			path: escapePath(this.uri.path) + '/tinymce-save',
			headers: {
				"Cookie": cookie,
			},
		};
		const response = await post(options, postData);
		const buffer = await getBuffer(response);
		return this.exists = buffer.equals(BaseFile.savedText);
	}
}