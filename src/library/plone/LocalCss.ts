import * as vscode from 'vscode';
import { get, getBuffer, escapePath } from '../util';
import { BaseFile } from '.';

export default class LocalCss extends BaseFile {
	static readonly fieldname = 'localCss';
	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	private async _load(cookie): Promise<boolean> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: escapePath(externalEditPath),
			headers: {
				Cookie: cookie,
			}
		});
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		this.parseExternalEdit(buffer);
		// TODO: change all settings to buffers?
		this.data = this.settings.get('localCss') || Buffer.from('');
		this.loading = false;
		return this.loaded = true;
	}
}