import * as vscode from 'vscode';
import * as url from 'url';
import { Portlet, PortletSideType, PortletManagerSides, PortletSideUrls } from ".";
import { Cookie } from "../../PloneFS";
import { get, getBuffer } from "../util";
import { parse, HTMLElement } from "node-html-parser";
import BaseFolder from './BaseFolder';

export default class PortletManager<S extends PortletSideType = PortletSideType> extends BaseFolder {
	entries: Map<string, Portlet>;
	side: S;

	constructor(parentUri: vscode.Uri, side: S) {
		const uri = parentUri.with({ path: parentUri.path + '/' + PortletSideUrls[side] });
		super(uri, true);
		this.side = side;

		this.type = vscode.FileType.Directory;
		this.entries = new Map<string, Portlet>();
	}

	protected async _load(): Promise<boolean> {
		// this.loading = false; // if we leave this true, load() will always return the promise
		return this.loaded = true;
	}

	protected async _loadEntries(cookie: Cookie): Promise<boolean> {
		const options = {
			host: this.uri.authority,
			path: this.path.dir + '/@@manage-portlets',
			headers: { cookie },
		};
		const response = await get(options);
		if (response.statusCode === 302 && response.headers.location && response.headers.location.indexOf('credentials_cookie_auth/require_login') !== 0) {
			this.loadingEntries = false;
			throw vscode.FileSystemError.NoPermissions(this.uri);
		}
		else if (response.statusCode !== 200) {
			this.loadingEntries = false;
			throw vscode.FileSystemError.Unavailable(this.uri);
		}
		const buffer = await getBuffer(response);
		const root = parse(buffer.toString()) as HTMLElement;
		const headerLinks = root.querySelectorAll(`#portletmanager-${PortletManagerSides[this.side]} .portletHeader div a`)
			// current version of parser cannot select tag and class
			.filter(link => link.classNames.length === 0) as HTMLElement[];
		for (const headerLink of headerLinks) {
			const href = headerLink.attributes['href'];
			const editUrl = url.parse(href);
			const editPath = editUrl.pathname!.substring(0, editUrl.pathname!.length - '/edit'.length);
			const name = editPath.substring(editPath.lastIndexOf('/') + 1);
			const title = headerLink.text;
			const portlet = new Portlet(this.uri.with({ path: this.uri.path + '/' + name }), true);
			portlet.title = title;
			this.entries.set(name, portlet);
		}
		this.loadingEntries = false;
		return this.loadedEntries = true;
	}
}