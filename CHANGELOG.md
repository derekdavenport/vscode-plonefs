# Change Log

## 0.3.0

- Added to Plone Options context menu: Check out, Cancel Check Out, Check In
- Added support for News Items, Events, and Collections (aka Topics)
- Added setting State
- Added Title and State to status bar
- Fixed not being able to edit a file's Title / Description
- Fixed new Title / Description only visible on View page
- Alphabetically sorted open site menu

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