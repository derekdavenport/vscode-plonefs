import * as vscode from 'vscode';
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
}