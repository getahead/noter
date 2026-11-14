use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines};
use tokio::task::JoinHandle;

pub(super) struct Runner {
    input: Option<DuplexStream>,
    output: Lines<BufReader<DuplexStream>>,
    served: Option<JoinHandle<std::io::Result<()>>>,
}

impl Runner {
    pub(super) fn new(
        input: DuplexStream,
        output: DuplexStream,
        served: JoinHandle<std::io::Result<()>>,
    ) -> Self {
        Self {
            input: Some(input),
            output: BufReader::new(output).lines(),
            served: Some(served),
        }
    }

    pub(super) async fn send_raw(&mut self, line: &str) {
        self.send_bytes(format!("{line}\n").as_bytes()).await;
    }

    pub(super) async fn send_bytes(&mut self, bytes: &[u8]) {
        self.input
            .as_mut()
            .expect("runner input is open")
            .write_all(bytes)
            .await
            .unwrap();
    }

    pub(super) async fn send(&mut self, request: Value) {
        self.send_raw(&request.to_string()).await;
    }

    pub(super) async fn line(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.output.next_line())
            .await
            .expect("a line within 5 s")
            .unwrap()
            .expect("the harness is still writing");
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("not JSON: {line}"))
    }

    pub(super) async fn finish(mut self) -> Vec<Value> {
        self.input
            .take()
            .expect("runner input is open")
            .shutdown()
            .await
            .unwrap();
        let mut rest = vec![];
        while let Some(line) = self.output.next_line().await.unwrap() {
            rest.push(serde_json::from_str(&line).unwrap());
        }
        self.served
            .take()
            .expect("runner server is active")
            .await
            .unwrap()
            .unwrap();
        rest
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        if let Some(served) = self.served.take() {
            served.abort();
        }
    }
}
