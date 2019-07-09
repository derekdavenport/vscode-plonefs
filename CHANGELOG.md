# Change Log

## 0.4.7

- Removed stage.louisville.edu certificate fix
- Updated dependencies

## 0.4.6

- Removed unused files

## 0.4.5

- Fixed empty portlet options changing to ""

## 0.4.4

- Fixed unable to create new files

## 0.4.3

- Fixed unable to change state to private

## 0.4.2

- Enabled all folder options when a subfolder is added as the site root
- Fixed unable to edit Local CSS when a subfolder is added as the site root

## 0.4.1

- Hide title in status bar for LocalCss (has no title)
- Hide state option for root folder (it has no state)
- Fixed unable to change Portlet Header (requires full save to set)
- Fixed unable to open subfolder as root (this works again, but is not recommended)

## 0.4.0

- Added support for Portlets
- Added ability to log in again after login expires
- Fixed sometimes unable to change State
- Fixed unable to open Plone Options on root folder

## 0.3.3

- Fixed unable to open Local CSS
- After check out, new working copy will be opened
- Fixed working copies not disapearing from explorer after check in / cancel check out
- Fixed typo in "Plone Options" menu: "Cancel Check In" to "Cancel Check Out"
- Fixed file rename setting Title to id

## 0.3.2

- Fixed unable to add new site after login cancelled

## 0.3.1

- Fixed unable to add new site

## 0.3.0

- Added to Plone Options context menu: Check out, Cancel Check Out, Check In
- Added support for News Items, Events, and Collections (aka Topics)
- Added setting State
- Added Title and State to status bar
- Fixed not being able to edit a file's Title / Description
- Fixed new Title / Description only visible on View page
- Alphabetically sorted "Open Site" menu

## 0.2.1

- README changes

## 0.2

- Added Cut/Copy/Paste
  > Pasting a file will never overwrite a file with the same name,
even if you tell Visual Studio Code to do so.
Instead, Visual Studio Code will try to rename the file but differently from how Plone does.
This will cause Visual Studio Code to display an error (and close the file if it was open),
but the file should have pasted correctly and appear with a new name given by Plone.
- Fixed broken Rename
- Fixed opening multiple sites that share a path
- Removed Title/Description options from site root folder

## 0.1.4

- Consolidated context menu
- Fixed context menu not working on unloaded entries
- Local CSS option only shows up when available
- Fixed false error message when saving root CSS

## 0.1.3

- Change Title/Description from context menu (except root folder)
- Local CSS plugin support from context menu
