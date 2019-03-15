import { FileSystemError } from 'vscode';
import * as Form from 'form-data';
import { Document } from '.';
import { copyMatch } from '../util';
/**
 * Documents can be checked out
 */
export default class Page extends Document {
	static readonly type_name: string = 'Document';

	async canCheckIn(): Promise<boolean> {
		const match = copyMatch(this.name);
		if (match) {
			const response = await this.client(this.uri.path + '/@@iterate_control/checkin_allowed'); //.buffer();
			return response.body.equals(Page.TRUE_BUFFER);
		}
		return false;
	}
	async canCheckOut(): Promise<boolean> {
		const response = await this.client(this.uri.path + '/@@iterate_control/checkout_allowed'); //.buffer();
		return response.body.equals(Page.TRUE_BUFFER);
	}

	async checkIn(message: string): Promise<string> {
		const body = new Form();
		body.append('checkin_message', message);
		body.append('form.button.Checkin', 'Check+in');
		const response = await this.client.post(this.uri.path + '/@@content-checkin', { body });
		if (response.statusCode !== 302) {
			throw FileSystemError.Unavailable(response.statusCode + ': ' + response.statusMessage);
		}
		const originalUriValue = response.headers['location'];
		if (!originalUriValue) {
			throw FileSystemError.Unavailable('could not check in working copy');
		}
		return originalUriValue;
	}

	async checkOut(): Promise<string> {
		const response = await this.client(this.uri.path + '/@@content-checkout');
		if (response.statusCode !== 302) {
			throw FileSystemError.Unavailable(response.statusCode + ': ' + response.statusMessage);
		}
		const newUriValue = response.headers['location'];
		if (!newUriValue) {
			throw FileSystemError.Unavailable('could not create working copy');
		}
		return newUriValue;
	}

	async cancelCheckOut(): Promise<void> {
		const body = new Form();
		body.append('form.button.Cancel', 'Cancel+checkout');
		const response = await this.client.post(this.uri.path + '/@@content-cancel-checkout', { body });
		if (response.statusCode !== 302) {
			throw FileSystemError.Unavailable(response.statusCode + ': ' + response.statusMessage);
		}
	}
}