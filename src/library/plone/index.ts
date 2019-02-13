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
export type State = 'internal' | 'external' | 'internally_published' | 'internally_restricted' | 'private' | 'pending';

export interface WithState {
	state: State;
}

export type WithStateType = Folder | Document;
export type WithLocalCssType = Folder | Document;

export function isWithState(value: any): value is WithState {
	return value instanceof Folder || value instanceof Document;
}

export interface WithLocalCss {
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;
}

export function isWithLocalCss(value: any): value is WithLocalCss {
	return value instanceof Folder || value instanceof Document;
}