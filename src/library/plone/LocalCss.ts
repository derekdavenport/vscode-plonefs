import * as vscode from 'vscode';
import { get, postMultipartData, getBuffer, escapePath } from '../util';
import { BaseFile } from '.';

export default class LocalCss extends BaseFile {
	static readonly fieldname = 'localCss';
	forRoot: boolean;
	constructor(uri: vscode.Uri, exists = false, forRoot = false) {
		super(uri, exists);
		this.forRoot = forRoot;
	}

	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this.forRoot ? this._loadRoot(cookie) : this._load(cookie);
	}

	private async _load(cookie: string): Promise<boolean> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: escapePath(externalEditPath),
			headers: {
				Cookie: cookie,
			},
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

	private async _loadRoot(cookie: string): Promise<boolean> {
		const response = await get({
			host: this.uri.authority,
			path: escapePath(this.uri.path),
			headers: {
				Cookie: cookie,
			},
		});
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		const cssBuffer = this.getRootCss(buffer);
		this.data = cssBuffer;
		return this.loaded = !(this.loading = false);
	}

	private getRootCss(buffer: Buffer) {
		const startBuffer = Buffer.from('/* Local CSS from site root */\n');
		let startIndex = buffer.indexOf(startBuffer);
		if (startIndex === -1) {
			throw vscode.FileSystemError.Unavailable('no local css found');
		}
		startIndex += startBuffer.length;
		const endLocalBuffer = Buffer.from('\n/* Local CSS from /front-page */');
		const endTagBuffer = Buffer.from('\n</style>');
		let endIndex = buffer.indexOf(endLocalBuffer, startIndex);
		if (endIndex === -1) {
			endIndex = buffer.indexOf(endTagBuffer, startIndex);
		}
		if (endIndex === -1) {
			throw vscode.FileSystemError.Unavailable('could not find end of local css');
		}
		return buffer.slice(startIndex, endIndex);
	}

	async save(cookie: string): Promise<boolean> {
		if (!this.forRoot) {
			return super.save(cookie);
		}
		const options = {
			host: this.uri.authority,
			path: escapePath(this.uri.path) + '/@@localcss-settings',
			Cookie: cookie.split(';')[0],
		};
		const formData = {
			'form.widgets.site_local_css': this.data.toString(), // TODO: support Buffers
			'form.buttons.save': 'Save',
		};
		const response = await postMultipartData(options, formData);
		// TODO: errors also send 302, so check location to be same place posted to
		return response.statusCode === 302; // && response.headers['location'] === ;
	}
}