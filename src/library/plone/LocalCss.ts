import * as vscode from 'vscode';
import { get, getBuffer, post } from '../util';
import { BaseFile } from '.';
import { RequestOptions } from 'https';

export default class LocalCss extends BaseFile {
	static readonly fieldname = 'localCss';
	forRoot: boolean;

	/**
	 * 
	 * @param uri 
	 * @param forRoot set true if this LocalCss belongs to the site root folder
	 */
	constructor(uri: vscode.Uri, forRoot = false) {
		super(uri, true);
		this.forRoot = forRoot;
	}

	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this.forRoot ? this._loadRoot(cookie) : this._load(cookie);
	}

	save(cookie: string): Promise<boolean> {
		return this.forRoot ? this._saveRoot(cookie) : super.save(cookie);
	}

	private async _load(cookie: string): Promise<boolean> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: externalEditPath,
			headers: { cookie },
		});
		if (response.statusCode !== 200) {
			this.loading = false;
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		this.parseExternalEdit(buffer);
		this.data = this.settings.get('localCss') || Buffer.from('');
		this.loading = false;
		return this.loaded = true;
	}

	private async _loadRoot(cookie: string): Promise<boolean> {
		const response = await get({
			host: this.uri.authority,
			path: this.uri.path + '/@@localcss-settings',
			headers: { cookie },
		});
		if (response.statusCode !== 200) {
			this.loading = false;
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		const cssBuffer = this._getRootCss(buffer);
		this.data = cssBuffer;
		return this.loaded = !(this.loading = false);
	}

	private _getRootCss(buffer: Buffer) {
		// TODO: this won't work if block local css is turned on
		const startBuffer = Buffer.from('/* Local CSS from site root */\n');
		let startIndex = buffer.indexOf(startBuffer);
		if (startIndex === -1) {
			Buffer.from('');
		}
		startIndex += startBuffer.length;
		const endBuffer = Buffer.from('\n</style>');
		let endIndex = buffer.indexOf(endBuffer, startIndex);
		if (endIndex === -1) {
			throw vscode.FileSystemError.Unavailable('could not find end of local css');
		}
		return buffer.slice(startIndex, endIndex);
	}

	private async _saveRoot(cookie: string): Promise<boolean> {
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/@@localcss-settings',
			headers: { cookie },
		};
		const formData = {
			'form.widgets.site_local_css': this.data.toString(), // TODO: support Buffers
			'form.buttons.save': 'Save',
		};
		const response = await post(options, formData);
		// errors also send 302, so check location to be same place posted to
		return response.statusCode === 302 && response.headers['location'] === this.uri.authority + this.uri.path;
	}
}