import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ProfileSchema, Profile } from '../types/profile';

export class ProfileParser {
  /**
   * Safely loads and parses an ecosystem configuration YAML file
   * @param relativePath Path to file relative to workspace directory
   */
  public static loadProfile(relativePath: string): Profile {
    const absolutePath = path.resolve(process.cwd(), relativePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Profile configuration file not found at location: ${absolutePath}`);
    }

    try {
      const rawFileContents = fs.readFileSync(absolutePath, 'utf8');
      const rawParsedYaml = yaml.parse(rawFileContents);

      // Perform strict runtime structural type-checking via Zod
      return ProfileSchema.parse(rawParsedYaml);
    } catch (error: any) {
      console.error(`❌ Validation Failure encountered parsing target configuration file: ${relativePath}`);
      throw error;
    }
  }
}
