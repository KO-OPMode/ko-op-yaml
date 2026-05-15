import * as fs from 'fs';
import * as path from 'path';

/**
 * Walk up the directory tree to find the root: Configs/ which contains Contains/Includes.
 */
export function findConfigsRoot(filePath: string): string | undefined
{
    let dir = path.dirname(filePath);
    while (true)
    {
        try
        {
            if ( path.basename(dir) === 'Configs' &&
                 fs.statSync(path.join(dir, 'Include')).isDirectory() )
            {
                return dir;
            }
        }
        catch  { /* keep walking */ }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return undefined;
}
