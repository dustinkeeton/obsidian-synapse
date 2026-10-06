export { AIClient, extractGeminiResponseText } from './ai-client';
export type { AIRequestOptions } from './ai-client';
export type { ChatMessage, ContentBlock, TextContentBlock, ImageContentBlock } from './types';
export {
	withRetry,
	sleep,
	classifyNetworkError,
	isTransientNetworkError,
	describeNetworkError,
} from './api-utils';
export {
	ensureFolder,
	readNote,
	writeNote,
	getMarkdownFiles,
	getIncludedMarkdownFiles,
	wordCount,
	findAvailableVaultPath,
} from './file-utils';
export { arrayBufferToBase64, base64EncodedLength } from './encoding';
export { redactSecrets, redactError } from './redact';
export { PROVIDER_METADATA, aiProviderToCredential } from './provider-metadata';
export type { CredentialProvider, ProviderMetadata, ProbeSpec } from './provider-metadata';
export { validateCredentials } from './credential-validator';
export type { ValidationResult, ValidationStatus, ValidateOptions } from './credential-validator';
export { decorateCredentialField } from './credential-field';
export type { CredentialFieldOptions, CredentialFieldHandle } from './credential-field';
export { NotificationManager, linkLoadError } from './notifications';
export type { OperationHandle, NoticeAction } from './notifications';
export { reviewAction } from './review-action';
export type { ReviewActionOptions } from './review-action';
export { UpdateChecker, isNewerVersion } from './update-checker';
export type { UpdateCheckerDeps } from './update-checker';
export { fireAndForget } from './fire-and-forget';
export type { FireAndForgetOptions } from './fire-and-forget';
export type { ModuleDeps, FeatureModule, FeatureSettingsKey } from './feature-module';
export { FolderPickerModal } from './folder-picker-modal';
export { openScanFolderPicker } from './open-scan-folder-picker';
export {
	sanitizeUrl,
	sanitizePath,
	ensureWithinVault,
	sanitizeAIResponse,
	stripCodeFences,
	blockquoteOriginal,
	parseTimestamp,
	validateTimeRange,
	formatTimeRange,
} from './validation';
export type { TimeRange } from './validation';
export { CALLOUT_TYPES, buildCallout, calloutForTranscriptionResult, ENRICHMENT_START, ENRICHMENT_END } from './callouts';
export type { CalloutType } from './callouts';
export {
	MARKER_KINDS,
	buildMarkerSection,
	markerOpener,
	markerCloser,
	parseMarkerOpener,
	parseMarkerCloser,
	findMarkerRegions,
	markerCoveredLines,
	markerAttrsMatch,
	encodeMarkerAttr,
	decodeMarkerAttr,
} from './markers';
export type { MarkerKind, MarkerAttrs, MarkerOpener, MarkerRegion } from './markers';
export {
	parseFrontmatter,
	serializeFrontmatter,
	mergeTags,
	normalizeFrontmatterTags,
} from './frontmatter-utils';
export type { ParsedNote } from './frontmatter-utils';
export { parseJson, isRecord, asStringArray, readJsonFile } from './json-utils';
export {
	generateTreeDiagram,
	generateMoveDiagram,
	generateOrganizeSummary,
} from './diagram-generator';
export type { TreeNode, MoveRecord } from './diagram-generator';
export { fetchTweetContent, isTwitterUrl } from './tweet-fetcher';
export type { TweetContent } from './tweet-fetcher';
export { fetchRedditContent, isRedditUrl, extractCanonicalPostUrl } from './reddit-fetcher';
export type { RedditContent } from './reddit-fetcher';
export {
	fetchPageContent,
	fetchPageContentWithImages,
	fetchHtmlDocument,
	extractImageUrls,
	stripTrackingParams,
	fetchArticleContent,
	extractReadableText,
	extractTitle,
	extractMetaDescription,
	extractJsonLdRecipes,
	formatRecipeStructuredData,
} from './content-fetcher';
export type { RecipeJsonLd } from './content-fetcher';
export type { SourceImage, SourceContext } from './source-context';
export { classifyUrl, extractUrls, findUrls, findMarkdownLinks } from './url-classifier';
export type { UrlContentType, UrlClassification, UrlMatch, MarkdownLinkMatch } from './url-classifier';
export { reduceToProse, proseCharCount, isEffectivelyEmptyProse, stripUrls, MIN_PROSE_CHARS } from './prose-reduction';
export { detectPlatform, isSupportedUrl } from './url-detector';
export type { Platform, UrlDetectionResult } from './url-detector';
export { addEnhancedSlider } from './slider-helper';
export { addCollapsibleSection } from './collapsible-section';
export type {
	CollapsibleSection,
	CollapsibleSectionOptions,
} from './collapsible-section';
export { renderFeatureChipSelect } from './feature-chip-select';
export type { FeatureChipSelectOptions } from './feature-chip-select';
export {
	createSettingsSectionContext,
	isSectionCollapsed,
	persistCollapse,
} from './settings-section';
export type {
	SettingsSectionContext,
	SettingsSectionContextOptions,
	SectionRegistryEntry,
	FeatureToggleListener,
} from './settings-section';
export { ConfirmModal } from './confirm-modal';
export type { ConfirmModalOptions } from './confirm-modal';
export {
	sectionHasReset,
	applySectionReset,
	sectionMatchesDefaults,
	applyResetAll,
} from './settings-reset';
export {
	findMatchingRule,
	isPathExcluded,
	matchesExcludeTag,
	ALL_FEATURE_IDS,
	buildMigratedExclusions,
} from './exclusions';
export type { FeatureId, ExclusionRule, LegacyModuleExclusions, ExclusionSettings } from './exclusions';
export {
	migrateSettings,
	readSettingsVersion,
	CURRENT_SETTINGS_VERSION,
	SETTINGS_MIGRATIONS,
} from './settings-migrations';
export type { SettingsMigration } from './settings-migrations';
export { migrateDataFolder, LEGACY_DATA_FOLDER, DATA_FOLDER } from './data-folder-migration';
export { deepMergeSettings } from './settings-merge';
export {
	CONTENT_SCHEMAS,
	detectSchemaFor,
	isRecipeContent,
	scoreRecipeContent,
	isReceiptContent,
	scoreReceiptContent,
	isLyricsContent,
	scoreLyricsContent,
} from './content-schemas';
export type { ContentSchema, PipelineStage, SchemaMode } from './content-schemas';
export { generateId, isValidCheckpointId } from './id-utils';
export { hashString, contentKey } from './hash-utils';
export { wrapUntrusted, UNTRUSTED_OPEN_TAG, UNTRUSTED_CLOSE_FENCE } from './untrusted-content';
export { resolveInsertionPoint, applyInsertion, describeInsertion, locateRegion, scanBlocks } from './insertion-point';
export type { InsertionAnchor, InsertionStrategy, InsertionBlockType, ResolvedInsertion, RegionLocator, ResolveInsertionOptions, LocatedRegion } from './insertion-point';
export { isUntitled, isGenericTitle } from './title-detector';
export {
	loadNodeModules,
	assertDesktop,
	shellEnv,
	DesktopOnlyError,
} from './node-loader';
export type { NodeModules } from './node-loader';
export { NoteOperationQueue } from './note-operation-queue';
export type { NoteOperationOptions } from './note-operation-queue';
export { TranscriptCache, canonicalMediaUrl, transcriptCacheKey } from './transcript-cache';
export type { CachedTranscript, TranscriptCacheEntry, TranscriptCacheOptions } from './transcript-cache';
export {
	NoSpeechDetectedError,
	NO_SPEECH_MESSAGE,
	MIN_TRANSCRIPT_CHARS_FOR_AI,
	isNoSpeechError,
	hasSpeechContent,
	isWorthPostProcessing,
	noSpeechNotice,
} from './no-speech';
export { mergeCacheUse, trackAiCache, transcriptCacheUse, withCacheReport } from './cache-notice';
export type { CacheUse } from './cache-notice';
export { CheckpointManager } from './checkpoint-manager';
export type {
	Checkpoint,
	CheckpointModule,
	CheckpointStatus,
	CheckpointWorkItem,
	DeferredTask,
} from './checkpoint-types';
export { BUILD_INFO, PRODUCTION_BUILD, parseBuildInfo, formatBuiltAt, describeDevBuild } from './build-info';
export type { BuildInfo } from './build-info';
