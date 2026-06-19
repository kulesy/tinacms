import { GitBackedDatabase, FilesystemBridge } from '@tinacms/datalayer';

/**
 * Git-only backend (POC).
 *
 * Content is read and written straight from the git working tree via the
 * FilesystemBridge. There is NO external database (no Mongo/Redis/SQLite) and
 * NO index layer - reads are resolved from the files on demand.
 *
 * For a real deployment you'd also pass a gitProvider (e.g. GitHubProvider) so
 * saves commit back to the remote. Here, writes land in the local working tree,
 * which is enough to demonstrate the editing flow end-to-end.
 */
export default new GitBackedDatabase({
  bridge: new FilesystemBridge(process.cwd()),
  tinaDirectory: 'tina',
});
