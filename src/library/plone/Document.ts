import * as vscode from 'vscode';
import { BaseFile, LocalCss, State, WithState, WithLocalCss, WithPortlets, PortletManagers, PortletManager } from '.';

export default abstract class Document extends BaseFile implements WithState, WithLocalCss, WithPortlets {
	static readonly fieldname = 'text';

	state: State;
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;

	portletManagers: PortletManagers;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);

		this.state = 'internal';
		// special feature for UofL localcss plugin
		this.hasLocalCss = uri.authority.endsWith('louisville.edu');
		if (this.hasLocalCss) {
			this.localCss = new LocalCss(uri);
		}
		this.portletManagers = {
			top: new PortletManager<'top'>(this.uri, 'top'),
			right: new PortletManager<'right'>(this.uri, 'right'),
			bottom: new PortletManager<'bottom'>(this.uri, 'bottom'),
			left: new PortletManager<'left'>(this.uri, 'left'),
		};
	}
}