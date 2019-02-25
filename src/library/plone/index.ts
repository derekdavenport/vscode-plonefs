import PloneObject from './PloneObject';
import Folder from './Folder';
import BaseFile from './BaseFile';
import Document from './Document';
import Page from './Page';
import NewsItem from './NewsItem';
import Event from './Event';
import Topic from './Topic';
import File from './File';
import LocalCss from './LocalCss';

export { PloneObject, Folder, BaseFile, Document, Page, NewsItem, Event, Topic, File, LocalCss };
export type Entry = Folder | BaseFile | Document;

export enum StateText {
	internal = 'Internal draft',
	external = 'Externally visible',
	internally_published = 'Internally published',
	internally_restricted = 'Internally restricted',
	private = 'Private',
	pending = 'Pending review',
};

export enum TextState {
	'Internal draft' = 'internal',
	'Externally visible' = 'external',
	'Internally published' = 'internally_published',
	'Internally restricted' = 'internally_restricted',
	'Private' = 'private',
	'Pending review' = 'pending',
};

export type State = keyof typeof StateText;

export interface WithState {
	state: State;
}

export function isWithState(value: any): value is WithState {
	return value instanceof Object && Object.keys(StateText).includes((value as WithState).state);
}

export interface WithLocalCss {
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;
}

export function isWithLocalCss(value: any): value is WithLocalCss {
	return value instanceof Object && typeof (value as WithLocalCss).hasLocalCss === 'boolean';
}