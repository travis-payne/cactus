const elliptic = require("elliptic");
const { SHA256 } = require("sha2");
const { KEYUTIL } = require("jsrsasign");
import FabricCAServices from "fabric-ca-client";
import { Wallet } from "fabric-network";
import * as fs from "fs";
import * as path from "path";

/**
 * This class contains some utility functions for creating signed proposals/transactions.
 * Currently it's only being used in test cases, but it's here if in future iterations
 * we want to actually do the signing ourselves.
 *
 */
export default class Utils {
  private static adminUserId = "admin";
  private static adminUserPasswd = "adminpw";

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

  static buildCCPOrg1 = (): Record<string, any> => {
    // load the common connection configuration file
    const ccpPath = path.resolve(
      __dirname,
      "organizations",
      "peerOrganizations",
      "org1.example.com",
      "connection-org1.json",
    );
    const fileExists = fs.existsSync(ccpPath);
    if (!fileExists) {
      throw new Error(`no such file or directory: ${ccpPath}`);
    }
    const contents = fs.readFileSync(ccpPath, "utf8");

    // build a JSON object from the file contents
    const ccp = JSON.parse(contents);

    console.log(`Loaded the network configuration located at ${ccpPath}`);
    return ccp;
  };

  static buildCAClient = (
    ccp: Record<string, any>,
    caHostName: string,
  ): FabricCAServices => {
    // Create a new CA client for interacting with the CA.
    const caInfo = ccp.certificateAuthorities[caHostName]; // lookup CA details from config
    const caTLSCACerts = caInfo.tlsCACerts.pem;
    const caClient = new FabricCAServices(
      caInfo.url,
      { trustedRoots: caTLSCACerts, verify: false },
      caInfo.caName,
    );

    console.log(`Built a CA Client named ${caInfo.caName}`);
    return caClient;
  };

  static enrollAdmin = async (
    caClient: FabricCAServices,
    wallet: Wallet,
    orgMspId: string,
  ): Promise<any | void> => {
    try {
      // Enroll the admin user, and import the new identity into the wallet.
      const enrollment = await caClient.enroll({
        enrollmentID: Utils.adminUserId,
        enrollmentSecret: Utils.adminUserPasswd,
      });
      const x509Identity = {
        credentials: {
          certificate: enrollment.certificate,
          privateKey: enrollment.key.toBytes(),
        },
        mspId: orgMspId,
        type: "X.509",
      };
      await wallet.put(Utils.adminUserId, x509Identity);
      console.log(
        "Successfully enrolled admin user and imported it into the wallet",
      );
      return x509Identity;
    } catch (error) {
      console.error(`Failed to enroll admin user : ${error}`);
    }
  };

  static registerAndEnrollUser = async (
    caClient: FabricCAServices,
    wallet: Wallet,
    orgMspId: string,
    userId: string,
    affiliation: string,
  ): Promise<any | void> => {
    try {
      // Check to see if we've already enrolled the user
      const userIdentity = await wallet.get(userId);
      if (userIdentity) {
        console.log(
          `An identity for the user ${userId} already exists in the wallet`,
        );
        return;
      }

      // Must use an admin to register a new user
      const adminIdentity = await wallet.get(Utils.adminUserId);
      if (!adminIdentity) {
        console.log(
          "An identity for the admin user does not exist in the wallet",
        );
        console.log("Enroll the admin user before retrying");
        return;
      }

      // build a user object for authenticating with the CA
      const provider = wallet
        .getProviderRegistry()
        .getProvider(adminIdentity.type);
      const adminUser = await provider.getUserContext(
        adminIdentity,
        Utils.adminUserId,
      );

      // Register the user, enroll the user, and import the new identity into the wallet.
      // if affiliation is specified by client, the affiliation value must be configured in CA
      const secret = await caClient.register(
        {
          affiliation,
          enrollmentID: userId,
          role: "client",
        },
        adminUser,
      );
      const enrollment = await caClient.enroll({
        enrollmentID: userId,
        enrollmentSecret: secret,
      });
      const x509Identity = {
        credentials: {
          certificate: enrollment.certificate,
          privateKey: enrollment.key.toBytes(),
        },
        mspId: orgMspId,
        type: "X.509",
      };
      await wallet.put(userId, x509Identity);
      return x509Identity;
    } catch (error) {
      console.error(`Failed to register user : ${error}`);
    }
  };
}
