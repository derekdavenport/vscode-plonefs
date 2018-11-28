import PloneObject from './PloneObject';
import Folder from './Folder';
import Document from './Document';
import File from './File';

export { PloneObject, Folder, Document, File };
export type Entry = Folder | Document | File;