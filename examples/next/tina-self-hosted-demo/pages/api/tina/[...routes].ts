import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer';

import databaseClient from '../../../tina/__generated__/databaseClient';

// POC: no-auth backend so the git-only database can be demonstrated without an
// auth provider. A real deployment would swap in AuthJsBackendAuthProvider.
const handler = TinaNodeBackend({
  authProvider: LocalBackendAuthProvider(),
  databaseClient,
});

export default (req, res) => {
  // Modify the request here if you need to
  return handler(req, res);
};
