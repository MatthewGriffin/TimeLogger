/**
 * Windows PowerShell SecretStore Vault utility - DEPRECATED
 * 
 * This file is no longer used. All credentials are now configured through the Settings page
 * and stored in the application config (database), not in Windows Vault.
 * 
 * Keeping this file for backwards compatibility, but all exports are now no-ops.
 */

/**
 * @deprecated Use config store instead
 */
export function getSecret(vaultName, secretName) {
  throw new Error(
    'Vault access is no longer supported. Please configure credentials through Settings page.\n' +
    'Credentials are stored in application config, not Windows Vault.'
  );
}

/**
 * @deprecated Use config store instead
 */
export function setSecret(vaultName, secretName, value) {
  throw new Error(
    'Vault storage is no longer supported. Please configure credentials through Settings page.\n' +
    'Credentials are stored in application config, not Windows Vault.'
  );
}

/**
 * @deprecated Use config store instead
 */
export function secretExists(vaultName, secretName) {
  return false;
}

/**
 * @deprecated Use config store instead
 */
export function deleteSecret(vaultName, secretName) {
  throw new Error(
    'Vault operations are no longer supported. Please configure credentials through Settings page.\n' +
    'Credentials are stored in application config, not Windows Vault.'
  );
}
