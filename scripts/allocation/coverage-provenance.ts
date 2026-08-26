import { spawnSync } from "node:child_process";

type AncestorCheck = (commit: string) => boolean;

export const gitCommitIsAncestorOfHead: AncestorCheck = (commit) => {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", commit, "HEAD"],
    { stdio: "ignore" },
  );
  if (result.error) throw new Error("Unable to verify coverage producer commit ancestry");
  return result.status === 0;
};

export const assertProducerCommitReachable = (
  producerCommit: string,
  isAncestor: AncestorCheck = gitCommitIsAncestorOfHead,
): void => {
  if (!isAncestor(producerCommit)) {
    throw new Error(`Coverage producerCommit ${producerCommit} is not an ancestor of HEAD`);
  }
};
