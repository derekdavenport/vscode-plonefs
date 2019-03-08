import * as vscode from 'vscode';
import { BaseFile } from ".";
import { Cookie } from "../../PloneFS";
import { get, getBuffer, post } from "../util";
import { parse, HTMLElement } from 'node-html-parser';

export default class Portlet extends BaseFile {
	omitBorder: 'on' | '';
	footer: string;
	moreUrl: string;
	authenticator: string;
	inputs: { [name: string]: string };
	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);

		this.omitBorder = '';
		this.footer = '';
		this.moreUrl = '';
		this.authenticator = '';
		this.inputs = {};
	}

	protected async _load(cookie: Cookie) {
		const options = {
			host: this.uri.authority,
			path: this.uri.path + '/edit',
			headers: { cookie },
		};
		const response = await get(options);
		if (response.statusCode === 302) {
			this.loading = false;
			throw vscode.FileSystemError.NoPermissions(this.uri);
		}
		else if (response.statusCode !== 200) {
			this.loading = false;
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		const root = parse(buffer.toString()) as HTMLElement;
		// node-html-parser unable to understand id or class with . in it or tag with attribute selector
		// textarea#form\.text
		const form = root.querySelector('.kssattr-formname-edit');
		const textarea = form.querySelector('textarea');
		// not a text portlet
		if (!textarea) {
			throw new Error('not a text portlet');
		}
		this.data = Buffer.from(textarea.text);
		this.inputs = form.querySelectorAll('input').reduce((inputs, input) => {
			if (
				input.attributes.type !== 'submit' &&
				(input.attributes.type !== 'checkbox' || input.attributes.checked)
			 ) {
				inputs[input.attributes.name] = input.attributes.value;
			}
			return inputs;
		}, this.inputs);
		return this.loaded = true;
	}

	async save(cookie: Cookie) {
		const options = {
			host: this.uri.authority,
			path: this.uri.path + '/edit',
			headers: { cookie },
		}
		const postData = {
			...this.inputs,
			//referer: this.path.dir + '/@@manage-portlets',
			'form.text': this.data.toString(),
			'form.actions.save': 'Save',
		};
		const response = await post(options, postData);
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// portlets cannot be renamed
		return this.exists = true;
	}
}