import { Injectable } from '@nestjs/common';
import type { FieldConfig, HydratedFieldConfig } from '../types/field-config.type';
import type { FormData } from '../dynamic-form-validation/dynamic-form-validation.types';
import type { FileInfo } from 'src/schemas/common/file.schema';
import { FileInfoNormalizerService } from './file-info-normalizer.service';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { stripSupportingContentMeta } from '../utils/xvi-fc-supporting-content-visibility.util';

/**
 * Shared hydrator for XVIFC state-level form GET responses: merges saved answers into templates
 * and signs file links. Per-form extras remain with each caller.
 * Does not resolve upload folderPath—only needed for edit-mode uploads. Callers can apply
 * resolveXviFcFolderPathsInFormJson separately when required.
 */

@Injectable()
export class FormQuestionHydratorService {
  constructor(
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly fileTokenService: FileTokenService,
  ) {}

  hydrate(questions: FieldConfig[], savedData: FormData): HydratedFieldConfig[] {
    return questions.map((question) => {
      const value = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      let hydrated: HydratedFieldConfig;
      if (question.formFieldType === 'file') {
        const fileVal = value as FileInfo | null | undefined;
        const hydratedFile = this.fileInfoNormalizer.hydrateFileInfoForResponse(fileVal ?? null, (p) =>
          this.fileTokenService.signFileUrlForSession(p),
        );
        hydrated = { ...question, value: hydratedFile ?? value };
      } else {
        hydrated = { ...question, value };
      }

      // `meta` is a backend-only extension point (e.g. a raw S3 path backing a template-download
      // action) — must never leak to any client, regardless of which form/role is asking. A no-op
      // when the question has no supportingContent.
      return { ...hydrated, supportingContent: stripSupportingContentMeta(hydrated.supportingContent) };
    });
  }
}
