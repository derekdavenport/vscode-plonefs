import { BaseFile, LocalCss, State, WithState, WithLocalCss, WithPortlets, PortletManagers, PortletManager, PloneObjectOptions, StateAction } from '.';

export default abstract class Document extends BaseFile implements WithState, WithLocalCss, WithPortlets {
	static readonly fieldname = 'text';

	state: State;
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;

	portletManagers: PortletManagers;

	constructor(options: PloneObjectOptions) {
		super(options);
		const { uri } = options;
		this.state = 'internal';
		// special feature for UofL localcss plugin
		this.hasLocalCss = uri.authority.endsWith('louisville.edu');
		if (this.hasLocalCss) {
			this.localCss = new LocalCss(options);
		}
		this.portletManagers = {
			top:    new PortletManager({ client: this.client, parentUri: this.uri, side: 'top' }),
			right:  new PortletManager({ client: this.client, parentUri: this.uri, side: 'right' }),
			bottom: new PortletManager({ client: this.client, parentUri: this.uri, side: 'bottom' }),
			left:   new PortletManager({ client: this.client, parentUri: this.uri, side: 'left' }),
		};
	}

	changeState(stateAction: StateAction) {
		return this._changeState(stateAction);
	}
}