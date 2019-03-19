import * as vscode from 'vscode';
import * as Form from 'form-data';
import { BaseFile, PloneObjectOptions } from ".";
import { parse, HTMLElement } from 'node-html-parser';

export default class Portlet extends BaseFile {
	omitBorder: 'on' | '';
	footer: string;
	moreUrl: string;
	authenticator: string;
	inputs: { [name: string]: string };
	constructor(options: PloneObjectOptions) {
		super(options);

		this.omitBorder = '';
		this.footer = '';
		this.moreUrl = '';
		this.authenticator = '';
		this.inputs = {};
	}

	protected async _load(): Promise<void> {
		const response = await this.client(this.uri.path + '/edit', { encoding: 'utf8' }); //.text();
		this.loading = false;
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const root = parse(response.body) as HTMLElement;
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
				input.attributes.name !== 'form.header' &&
				input.attributes.type !== 'submit' &&
				(input.attributes.type !== 'checkbox' || input.attributes.checked)
			 ) {
				inputs[input.attributes.name] = input.attributes.value;
			}
			return inputs;
		}, this.inputs);
		this.loaded = true;
	}

	async save() {
		const savePath = this.exists ? this.uri.path + '/edit' : this.path.dir + '/+/plone.portlet.static.Static';
		const body = new Form();
		for (const [key, value] of Object.entries(this.inputs)) {
			body.append(key, value);
		}
		body.append('form.header', this.title);
		body.append('form.text', this.data); // can't be empty
		body.append('form.actions.save', 'Save');
		const response = await this.client.post(savePath, { body });
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// portlets cannot be renamed
		this.exists = true;
	}
}