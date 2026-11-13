use compiler::{analyze, parse, ArtifactBundle, CodeGenerator};
use std::fs;

const SOURCE: &str = include_str!("Freightline.synq");

fn compile() -> ArtifactBundle {
    let (_, ast) = parse(SOURCE).expect("parse Freightline");
    analyze(&ast).expect("analyze Freightline");
    let code = CodeGenerator::new()
        .generate_stateful(&ast)
        .expect("generate stateful SynQ IR");
    ArtifactBundle::generate(SOURCE, &ast, code).expect("generate Freightline artifacts")
}

fn main() -> std::io::Result<()> {
    let bundle = compile();
    fs::create_dir_all("artifacts")?;
    fs::write("artifacts/Freightline.compiled.synq", &bundle.bytecode)?;
    fs::write(
        "artifacts/Freightline.abi.json",
        bundle.abi_json().expect("serialize ABI"),
    )?;
    fs::write(
        "artifacts/Freightline.manifest.json",
        bundle.manifest_json().expect("serialize manifest"),
    )?;
    println!("SynQ stateful IR v2 · Synergy Testnet v3 · chain 1266");
    println!("Bytecode SHA-256 {}", bundle.hashes.bytecode_hash);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aivm_core::execution::{ExecutionRequest, ExecutionStatus};
    use aivm_core::state::ContractState;
    use aivm_core::stateful_synq::SynQValue;
    use aivm_core::synq_runtime::{call_synq_contract, deploy_synq_contract, SynQRuntimeReceipt};
    use serde_json::{json, Value};

    const ALICE: &str = "freightline-local-alice";
    const BOB: &str = "freightline-local-bob";
    const VISITOR: &str = "freightline-local-visitor";

    struct Match {
        request: ExecutionRequest,
        bundle: ArtifactBundle,
        state: ContractState,
    }

    impl Match {
        fn new() -> Self {
            let bundle = compile();
            let mut request =
                ExecutionRequest::synq("freightline-local", bundle.bytecode.clone(), 1_000_000);
            request.artifact.abi_json =
                Some(String::from_utf8(bundle.abi_json().unwrap()).unwrap());
            request.artifact.manifest_json =
                Some(String::from_utf8(bundle.manifest_json().unwrap()).unwrap());
            request.context.runtime_block_height = 1;
            request.context.block_height = 1;
            request.context.caller = ALICE.as_bytes().to_vec();
            request.calldata = b"[]".to_vec();
            let mut state = ContractState::default();
            let receipt = deploy_synq_contract(&request, &mut state);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Succeeded,
                "{:?}",
                receipt.error
            );
            assert!(receipt.native_transfers.is_empty());
            Self {
                request,
                bundle,
                state,
            }
        }

        fn execute(
            &mut self,
            caller: &str,
            method: &str,
            args: Value,
            value_nwei: u128,
        ) -> SynQRuntimeReceipt {
            let selector = self
                .bundle
                .abi
                .methods
                .iter()
                .find(|entry| entry.name == method)
                .unwrap_or_else(|| panic!("ABI method {method}"))
                .selector
                .trim_start_matches("0x");
            let mut request = self.request.clone();
            request.context.caller = caller.as_bytes().to_vec();
            request.context.call_value = value_nwei;
            request.calldata = (0..selector.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&selector[index..index + 2], 16).unwrap())
                .collect::<Vec<_>>();
            request.calldata.extend(serde_json::to_vec(&args).unwrap());
            let receipt = call_synq_contract(&request, &mut self.state);
            assert!(receipt.native_transfers.is_empty());
            receipt
        }

        fn call(&mut self, caller: &str, method: &str, args: Value) -> SynQValue {
            let receipt = self.execute(caller, method, args, 0);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Succeeded,
                "{method}: {:?}",
                receipt.error
            );
            serde_json::from_slice(&receipt.return_data).unwrap()
        }

        fn get(&mut self, method: &str, args: Value) -> u128 {
            let value = self.call(VISITOR, method, args);
            let SynQValue::Uint(number) = value else {
                panic!("Expected integer from {method}: {value:?}")
            };
            number
        }

        fn reject(&mut self, caller: &str, method: &str, args: Value, reason: &str) {
            let before = self.state.state_root();
            let receipt = self.execute(caller, method, args, 0);
            assert_eq!(
                receipt.status,
                ExecutionStatus::Reverted,
                "{method}: {:?}",
                receipt.error
            );
            assert!(
                receipt.error.unwrap_or_default().contains(reason),
                "{method}"
            );
            assert_eq!(self.state.state_root(), before);
            assert_eq!(receipt.pre_state_root, receipt.post_state_root);
        }
    }

    #[test]
    fn claims_routes_delivery_and_fuel_saver_match_the_schedule() {
        let mut game = Match::new();
        assert_eq!(game.get("currentRound", json!([])), 0);
        assert_eq!(game.get("playerBalance", json!([1])), 150);
        game.reject(ALICE, "claim", json!([1]), "No active shift");
        game.reject(ALICE, "join", json!([]), "Second account");
        game.call(BOB, "join", json!([]));
        game.reject(VISITOR, "join", json!([]), "Both seats");

        game.reject(BOB, "move", json!([8]), "Not your shift");
        game.reject(ALICE, "claim", json!([4]), "Job unavailable");
        game.call(ALICE, "claim", json!([1]));
        assert_eq!(game.get("jobStatus", json!([1])), 2);
        assert_eq!(game.get("remainingActions", json!([])), 3);
        game.reject(ALICE, "claim", json!([2]), "Finish your active job");
        game.reject(ALICE, "move", json!([4]), "adjacent road");
        game.reject(ALICE, "deliver", json!([]), "Load the active job");
        game.call(ALICE, "pickUp", json!([]));
        assert_eq!(game.get("jobStatus", json!([1])), 3);
        game.call(ALICE, "move", json!([3]));
        game.reject(ALICE, "deliver", json!([]), "at delivery");
        game.call(ALICE, "move", json!([4]));
        game.reject(ALICE, "deliver", json!([]), "No actions");
        assert_eq!(game.get("playerBalance", json!([1])), 132);
        game.call(ALICE, "endShift", json!([]));

        game.reject(BOB, "claim", json!([1]), "already claimed");
        game.call(BOB, "claim", json!([2]));
        game.call(BOB, "pickUp", json!([]));
        game.call(BOB, "move", json!([5]));
        game.call(BOB, "deliver", json!([]));
        assert_eq!(game.get("playerBalance", json!([2])), 177);
        game.call(BOB, "endShift", json!([]));

        assert_eq!(game.get("currentRound", json!([])), 2);
        game.call(ALICE, "deliver", json!([]));
        assert_eq!(game.get("jobStatus", json!([1])), 4);
        assert_eq!(game.get("playerBalance", json!([1])), 179);
        game.reject(ALICE, "claim", json!([1]), "already claimed");
        game.call(ALICE, "claim", json!([4]));
        game.call(ALICE, "move", json!([3]));
        game.call(ALICE, "pickUp", json!([]));
        game.call(ALICE, "endShift", json!([]));
        game.call(BOB, "endShift", json!([]));

        game.call(ALICE, "move", json!([1]));
        game.call(ALICE, "deliver", json!([]));
        game.call(ALICE, "upgrade", json!([1]));
        assert_eq!(game.get("playerBalance", json!([1])), 177);
        game.call(ALICE, "endShift", json!([]));
        game.call(BOB, "endShift", json!([]));
        game.reject(ALICE, "upgrade", json!([1]), "Fuel Saver unavailable");
        game.call(ALICE, "move", json!([7]));
        assert_eq!(game.get("playerBalance", json!([1])), 172);
    }

    #[test]
    fn route_permit_allows_exactly_one_long_move_with_zero_actions() {
        let mut game = Match::new();
        game.call(BOB, "join", json!([]));
        game.call(ALICE, "endShift", json!([]));
        game.call(BOB, "upgrade", json!([2]));
        game.call(BOB, "move", json!([8]));
        game.call(BOB, "move", json!([6]));
        assert_eq!(game.get("remainingActions", json!([])), 0);
        game.call(BOB, "move", json!([2]));
        assert_eq!(game.get("playerBalance", json!([2])), 98);
        assert_eq!(game.get("playerPosition", json!([2])), 2);
        game.reject(BOB, "move", json!([6]), "No actions");
        game.call(BOB, "claim", json!([2]));
        game.reject(BOB, "pickUp", json!([]), "No actions");
        game.call(BOB, "endShift", json!([]));
        game.call(ALICE, "endShift", json!([]));
        game.call(BOB, "move", json!([6]));
        assert_eq!(game.get("remainingActions", json!([])), 3);
    }

    #[test]
    fn deadlines_discard_cargo_and_round_ten_finishes_the_match() {
        let mut game = Match::new();
        game.call(BOB, "join", json!([]));
        game.call(ALICE, "claim", json!([3]));
        game.call(ALICE, "move", json!([7]));
        game.call(ALICE, "pickUp", json!([]));
        for current in 1..=10 {
            assert_eq!(game.get("currentRound", json!([])), current);
            game.call(ALICE, "endShift", json!([]));
            if current <= 4 {
                assert_eq!(game.get("jobStatus", json!([3])), 3);
            }
            game.call(BOB, "endShift", json!([]));
            if current == 4 {
                assert_eq!(game.get("jobStatus", json!([3])), 5);
                assert_eq!(game.get("playerJob", json!([1])), 0);
                assert_eq!(game.get("playerBalance", json!([1])), 142);
                game.reject(ALICE, "claim", json!([3]), "Job unavailable");
                game.reject(ALICE, "deliver", json!([]), "Load the active job");
            }
        }
        assert_eq!(game.get("currentRound", json!([])), 10);
        assert_eq!(game.get("currentTurn", json!([])), 0);
        assert_eq!(game.get("winningSeat", json!([])), 2);
        assert_eq!(game.get("jobStatus", json!([12])), 5);
        game.reject(BOB, "endShift", json!([]), "No active shift");
    }

    #[test]
    fn equal_balances_share_the_result() {
        let mut game = Match::new();
        game.call(BOB, "join", json!([]));
        for _ in 0..10 {
            game.call(ALICE, "endShift", json!([]));
            game.call(BOB, "endShift", json!([]));
        }
        assert_eq!(game.get("currentTurn", json!([])), 0);
        assert_eq!(game.get("winningSeat", json!([])), 0);
    }

    #[test]
    fn low_balances_block_spending_and_preserve_end_shift() {
        let mut game = Match::new();
        game.call(BOB, "join", json!([]));
        for index in 0..18 {
            let destination = if index % 2 == 0 { 3 } else { 1 };
            game.call(ALICE, "move", json!([destination]));
            if index % 3 == 2 {
                game.call(ALICE, "endShift", json!([]));
                game.call(BOB, "endShift", json!([]));
            }
        }
        assert_eq!(game.get("playerBalance", json!([1])), 6);
        game.reject(
            ALICE,
            "move",
            json!([3]),
            "Insufficient practice SNRG for fuel",
        );
        game.reject(
            ALICE,
            "upgrade",
            json!([1]),
            "Insufficient practice SNRG for upgrade",
        );
        game.reject(
            ALICE,
            "upgrade",
            json!([1]),
            "Insufficient practice SNRG for upgrade",
        );
        game.call(ALICE, "endShift", json!([]));
        assert_eq!(game.get("currentTurn", json!([])), 2);
    }

    #[test]
    fn native_value_is_rejected_without_transfers_or_state_changes() {
        let mut game = Match::new();
        let mut request = game.request.clone();
        request.context.call_value = 1_000_000_000;
        let mut blank = ContractState::default();
        let receipt = deploy_synq_contract(&request, &mut blank);
        assert_eq!(receipt.status, ExecutionStatus::Reverted);
        assert!(receipt
            .error
            .unwrap_or_default()
            .contains("Practice SNRG only"));
        assert!(receipt.native_transfers.is_empty());
        assert_eq!(blank, ContractState::default());

        let before = game.state.state_root();
        for (method, args) in [("join", json!([])), ("currentRound", json!([]))] {
            let receipt = game.execute(BOB, method, args, request.context.call_value);
            assert_eq!(receipt.status, ExecutionStatus::Reverted);
            assert!(receipt
                .error
                .unwrap_or_default()
                .contains("Practice SNRG only"));
            assert_eq!(receipt.post_state_root, before);
            assert_eq!(game.state.state_root(), before);
        }
    }
}
