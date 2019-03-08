import * as vscode from 'vscode';
import { PloneObject, Entry } from ".";
import { Cookie } from '../../PloneFS';

export default abstract class BaseFolder extends PloneObject {
	abstract entries: Map<string, Entry>;
	loadingEntries: boolean;
	loadingEntriesPromise: Promise<boolean>;
	loadedEntries: boolean;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);

		this.loadingEntries = false;
		this.loadedEntries = false;
		this.loadingEntriesPromise = Promise.resolve(false);
	}

	loadEntries(cookie: Cookie): Promise<boolean> {
		if (this.loadingEntries) {
			return this.loadingEntriesPromise;
		}
		this.loadingEntries = true;
		return this.loadingEntriesPromise = this._loadEntries(cookie);
	}

	protected abstract async _loadEntries(cookie: Cookie): Promise<boolean>;
}