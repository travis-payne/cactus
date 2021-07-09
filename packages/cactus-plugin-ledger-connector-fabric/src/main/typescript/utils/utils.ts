const elliptic = require("elliptic");
const { SHA256 } = require("sha2");
const { KEYUTIL } = require("jsrsasign");

/**
 * This class contains some utility functions for creating signed proposals/transactions.
 * Currently it's only being used in test cases, but it's here if in future iterations
 * we want to actually do the signing ourselves.
 *
 */
export default class Utils {
  /**
   *  Per wikipedia: An encryption algorithm is "malleable" if it is possible to transform a ciphertext into another
   *  ciphertext which decrypts to a related plaintext.
   *
   *  This function achieves the above.
   *
   * @param sig
   * @returns a non malleable signature as a Buffer
   */
  static preventMalleability(sig: any): Buffer {
    const halfOrder = elliptic.curves.p256.n.shrn(1);
    if (sig.s.cmp(halfOrder) === 1) {
      const bigNum = elliptic.curves.p256.n;
      sig.s = bigNum.sub(sig.s);
    }
    return Buffer.from(sig.toDER());
  }

  /**
   * Generates a hash of the proposal, then signs it using some SHA-256 and some crypto magic.
   *
   * @param bytes
   * @param privateKey
   * @returns A signedProposal
   */
  static hashAndSignProposal(bytes: any, privateKey: any) {
    const digest = SHA256(bytes); // A hash function by the user's desire
    const { prvKeyHex } = KEYUTIL.getKey(privateKey);
    const EC = elliptic.ec;
    const ecdsaCurve = elliptic.curves["p256"];
    const ecdsa = new EC(ecdsaCurve);
    const signKey = ecdsa.keyFromPrivate(prvKeyHex, "hex");
    const sig = ecdsa.sign(Buffer.from(digest, "hex"), signKey);

    return sig;
  }
}
