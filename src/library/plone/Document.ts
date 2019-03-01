import * as vscode from 'vscode';
import { BaseFile, LocalCss, State, WithState, WithLocalCss, WithPortlets, PortletManagerSides } from '.';
import { Cookie } from '../../PloneFS';

export default abstract class Document extends BaseFile implements WithState, WithLocalCss, WithPortlets {
	static readonly fieldname = 'text';

	state: State;
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);

		this.state = 'internal';
		// special feature for UofL localcss plugin
		this.hasLocalCss = uri.authority.endsWith('louisville.edu');
		if (this.hasLocalCss) {
			this.localCss = new LocalCss(uri);
		}
	}

	loadPortlets(cookie: Cookie, side: keyof typeof PortletManagerSides): Promise<boolean> {
		return super._loadPortlets(cookie, side);
	}
}