import * as vscode from 'vscode';
import * as url from 'url';
import * as Form from 'form-data';
import { BaseFolder, Portlet, PortletSideType, PortletManagerSides, PortletSideUrls } from ".";
import { parse, HTMLElement } from "node-html-parser";
import * as got from 'got';

interface PortletManagerOptions<S extends PortletSideType> {
	client: got.GotFn;
	parentUri: vscode.Uri;
	side: S;
}

export default class PortletManager<S extends PortletSideType = PortletSideType> extends BaseFolder {
	entries: Map<string, Portlet>;
	side: S;

	constructor(options: PortletManagerOptions<S>) {
		const { parentUri, side } = options;
		const uri = parentUri.with({ path: parentUri.path + '/' + PortletSideUrls[side] });
		super({ ...options, uri, exists: true });
		this.side = side;

		this.type = vscode.FileType.Directory;
		this.entries = new Map<string, Portlet>();
		// nothing to load
		this.loaded = true;
	}

	async add(header: string): Promise<void> {
		const _authenticator = await this.getAuthenticator();
		
		const savePath = this.uri.path + '/+/plone.portlet.static.Static';
		const body = new Form();
		body.append('form.header', header);
		body.append('form.text', PortletManager.LINEFEED_BUFFER); // can't be empty
		body.append('_authenticator', _authenticator);
		body.append('form.actions.save', 'Save');
		const response = await this.client.post(savePath, { body, encoding: 'utf8' });
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// /++contextportlets++plone.rightcolumn/+/plone.portlet.static.Static
	}

	private async getAuthenticator(): Promise<string> {
		const body = {
			':action': '/' + this.path.base + '/+/plone.portlet.static.Static'
		};
		const response = await this.client.post(this.path.dir, { form: true, body, encoding: 'utf8' });
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		const inputIndex = response.body.indexOf('name="_authenticator"') + 'name="_authenticator"'.length;
		const start = response.body.indexOf('value="', inputIndex) + 'value="'.length;
		const end = response.body.indexOf('"', start);
		return response.body.substring(start, end);
	}

	protected async _load(): Promise<void> {
		// this.loading = false; // if we leave this true, load() will always return the promise
		this.loaded = true;
	}

	protected async _loadEntries(): Promise<void> {
		const response = await this.client(this.path.dir + '/@@manage-portlets', { encoding: 'utf8' }); //.text();
		this.loadingEntries = false;
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(this.uri);
		}
		const root = parse(response.body) as HTMLElement;
		const headerLinks = root.querySelectorAll(`#portletmanager-${PortletManagerSides[this.side]} .portletHeader div a`)
			// current version of parser cannot select tag and class
			.filter(link => link.classNames.length === 0) as HTMLElement[];
		for (const headerLink of headerLinks) {
			const href = headerLink.attributes['href'];
			const editUrl = url.parse(href);
			const editPath = editUrl.pathname!.substring(0, editUrl.pathname!.length - '/edit'.length);
			const name = editPath.substring(editPath.lastIndexOf('/') + 1);
			const title = headerLink.text;
			const portlet = new Portlet({ client: this.client, uri: this.uri.with({ path: this.uri.path + '/' + name }), exists: true });
			portlet.title = title;
			this.entries.set(name, portlet);
		}
		this.loadedEntries = true;
	}
}