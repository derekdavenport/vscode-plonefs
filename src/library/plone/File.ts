import * as vscode from 'vscode';
import * as Form from 'form-data';
import { Mode, linefeed } from '../util';
import { BaseFile, PloneObjectOptions } from '.';

export default class File extends BaseFile {
	language: string;
	state: null;

	constructor(options: PloneObjectOptions) {
		super(options);
		this.language = 'plaintext';
	}

	protected async _load(): Promise<void> {
		const loadPromise = super._load();

		const languagesPromise = vscode.languages.getLanguages();
		const contentTypeBuffer = this.settings.get('content_type');
		if (contentTypeBuffer) {
			const contentType = contentTypeBuffer.toString();
			const mimeType = contentType.split(';')[0];
			const [type, subtype] = mimeType.split('/');
			const languages = await languagesPromise;
			if (languages.indexOf(subtype) >= 0) {
				this.language = subtype;
			}
			else if (languages.indexOf(type) >= 0) {
				this.language = type;
			}
		}
		return loadPromise;
	}

	// File has no Python section
	protected parseExternalEdit(buffer: Buffer): Buffer {
		this.settings.clear();
		const modeSwitch = Buffer.from([linefeed, linefeed]);
		const headerStartIndex = 0;
		const headerEndIndex = buffer.indexOf(modeSwitch);
		const contentStartIndex = headerEndIndex + modeSwitch.length;
		const headerBuffer = buffer.slice(headerStartIndex, headerEndIndex);
		const contentBuffer = buffer.slice(contentStartIndex);
		this.parseExternalEditSection(headerBuffer, Mode.Header);
		return contentBuffer;
	}

	// load(cookie: string): Promise<boolean> {
	// 	if (this.loading) {
	// 		return this.loadingPromise;
	// 	}
	// 	this.loading = true;
	// 	return this.loadingPromise = this._load(cookie);
	// }

	// private async _load(cookie: string): Promise<boolean> {
	// 	const languagesPromise = vscode.languages.getLanguages();
	// 	const response = await get({
	// 		host: this.uri.authority,
	// 		path: this.uri.path + '/at_download/file',
	// 		headers: { cookie },
	// 	});
	// 	if (response.statusCode !== 200) {
	// 		this.loading = false;
	// 		throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
	// 	}

	// 	const contentType = response.headers['content-type'];
	// 	if (contentType) {
	// 		const mimeType = contentType.split(';')[0];
	// 		const [type, subtype] = mimeType.split('/');
	// 		const languages = await languagesPromise;
	// 		if (languages.indexOf(subtype) >= 0) {
	// 			this.language = subtype;
	// 		}
	// 		else if (languages.indexOf(type) >= 0) {
	// 			this.language = type;
	// 		}
	// 	}
	// 	this.data = await getBuffer(response);
	// 	this.loading = false;
	// 	return this.loaded = true;
	// }

	async save(): Promise<void> {
		let savePath = this.uri.path;
		if (!this.exists) {
			savePath = await this.getNewSavePath();
		}
		if (!this.data.length) {
			// plone does not allow empty files
			this.data = File.LINEFEED_BUFFER;
		}

		const body = new Form();
		body.append('id', this.name);
		body.append('title', this.title || this.name);
		body.append('form.submitted', '1');
		body.append('file_file', this.data, { filename: this.name });
		const response = await this.client.post(savePath + '/atct_edit', { body });
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		this.exists = true;
	}
}