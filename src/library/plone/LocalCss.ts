import * as vscode from 'vscode';
import * as Form from 'form-data';
import { BaseFile, PloneObjectOptions } from '.';

interface LocalCssOptions extends PloneObjectOptions {
	forRoot?: boolean;
}

export default class LocalCss extends BaseFile {
	static readonly fieldname = 'localCss';
	forRoot: boolean;

	/**
	 * 
	 * @param uri 
	 * @param forRoot set true if this LocalCss belongs to the site root folder
	 */
	constructor(options: LocalCssOptions) {
		super({ ...options, exists: true });
		this.forRoot = options.forRoot || false;
	}

	load(): Promise<void> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this.forRoot ? this._loadRoot() : this._load();
	}

	save(): Promise<void> {
		return this.forRoot ? this._saveRoot() : super.save();
	}

	protected async _load(): Promise<void> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await this.client(externalEditPath); //.buffer();
		this.loading = false;
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		this.parseExternalEdit(response.body);
		this.data = this.settings.get('localCss') || LocalCss.EMPTY_BUFFER;
		this.loaded = true;
	}

	private async _loadRoot(): Promise<void> {
		const response = await this.client(this.uri.path + '/@@localcss-settings'); //.buffer();
		this.loading = false;
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		this.data = this._getRootCss(response.body);
		this.loaded = true;
	}

	private _getRootCss(buffer: Buffer): Buffer {
		// TODO: this won't work if block local css is turned on
		const startBuffer = Buffer.from('/* Local CSS from site root */\n');
		let startIndex = buffer.indexOf(startBuffer);
		if (startIndex === -1) {
			throw vscode.FileSystemError.Unavailable('could not find start of local css');
		}
		startIndex += startBuffer.length;
		const endBuffer = Buffer.from('\n</style>');
		let endIndex = buffer.indexOf(endBuffer, startIndex);
		if (endIndex === -1) {
			throw vscode.FileSystemError.Unavailable('could not find end of local css');
		}
		return buffer.slice(startIndex, endIndex);
	}

	private async _saveRoot(): Promise<void> {
		const postPath = this.uri.path + '/@@localcss-settings';
		const body = new Form();
		body.append('form.widgets.site_local_css', this.data);
		body.append('form.buttons.save', 'Save');
		const response = await this.client.post(postPath, { body });
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// errors also send 302, so check location to be same place posted to
		if (response.headers['location'] !== 'https://' + this.uri.authority + postPath) {
			throw vscode.FileSystemError.Unavailable('Location error: ' + response.statusCode + ' ' + response.statusMessage);
		}
	}
}