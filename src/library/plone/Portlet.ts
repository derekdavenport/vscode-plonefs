import * as vscode from 'vscode';
import { BaseFile } from ".";
import { Cookie } from "../../PloneFS";
import { get, getBuffer } from "../util";
import { parse, HTMLElement } from 'node-html-parser';

export enum PortletSides {
	top = 'top',
	right = 'right',
	bottom = 'bottom',
	left = 'left',
}

export enum PortletUrls {
	'++contextportlets++uofl.heromanager' = 'top',
	'++contextportlets++plone.rightcolumn' = 'right',
	'++contextportlets++uofl.prefootermanager' = 'bottom',
	'++contextportlets++plone.leftcolumn' = 'left',
}

export enum PortletSideUrls {
	top = '++contextportlets++uofl.heromanager',
	right = '++contextportlets++plone.rightcolumn',
	bottom = '++contextportlets++uofl.prefootermanager',
	left = '++contextportlets++plone.leftcolumn',
}

export enum PortletManagerSides {
	top = 'uofl-heromanager',
	right = 'plone-rightcolumn',
	bottom = 'uofl-prefootermanager',
	left = 'plone-leftcolumn',
}

export default class Portlet extends BaseFile {
	side: 'top' | 'right' | 'bottom' | 'left';
	omitBorder: 'on' | '';
	footer: string;
	moreUrl: string;
	authenticator: string;
	inputs: { [name: string]: string };
	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		const portletUrl = this.path.dir.split('/').pop();
		if (!portletUrl || !(portletUrl in PortletUrls)) {
			throw Error('not a valid portlet URL');
		}
		this.side = PortletUrls[portletUrl as keyof typeof PortletUrls];
		this.omitBorder = '';
		this.footer = '';
		this.moreUrl = '';
		this.authenticator = '';
		this.inputs = {};
	}

	protected async _load(cookie: Cookie) {
		const response = await get({
			host: this.uri.authority,
			path: this.uri.path + '/edit',
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
			if (input.attributes.type !== 'submit') {
				inputs[input.attributes.name] = input.attributes.value;
			}
			return inputs;
		}, this.inputs);
		return this.loaded = true;
	}

	async save(cookie: Cookie) {
			const postData = {
				...this.inputs,
				//referer: this.path.dir + '/@@manage-portlets',
				'form.text': this.data.toString(),
				'form.actions.save': 'Save',
			}
			return true;
	}
}