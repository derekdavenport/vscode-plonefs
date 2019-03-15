'use strict';
import * as vscode from 'vscode';
import * as Form from 'form-data';
import { PloneObject, PloneObjectOptions } from ".";

/**
 * A Plone Object with data
 */
export default abstract class BaseFile extends PloneObject {
	data: Uint8Array;
	static readonly fieldname: string;

	constructor(options: PloneObjectOptions) {
		super(options);
		this.type = vscode.FileType.File;
		this.data = BaseFile.EMPTY_BUFFER;
	}

	async save(): Promise<void> {
		// if doesn't exist or a rename, need full save
		// TODO: make rename a separate function using POST setId value: id
		if (!this.exists || this.path.base !== this.name) {
			return super.save();
		}
		// this is a quick save and will not make an entry in edit history
		// TODO: make tinymce save its own function so code not duplicated in saveSetting
		const body = new Form();
		body.append('fieldname', (this.constructor as typeof BaseFile).fieldname);
		body.append('text', this.data);
		const response = await this.client.post(this.uri.path + '/tinymce-save', { body });//.buffer();
		this.exists = response.body.equals(BaseFile.SAVED_BUFFER);
	}

	protected async _load(): Promise<void> {
		const buffer = await this._loadExternalBuffer();
		this.data = this.parseExternalEdit(buffer);
		this.loaded = true;
	}
}