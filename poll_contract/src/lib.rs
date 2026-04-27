#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, String, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Poll {
    pub id: u32,
    pub question: String,
    pub options: Vec<String>,
    pub votes: Vec<u32>,
    pub created_at: u64,
    pub expires_at: u64,
    pub creator: Address,
    pub active: bool,
}

#[contracttype]
pub enum DataKey {
    Poll(u32),
    PollCount,
    UserVote(u32, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PollError {
    InvalidQuestion = 1,
    NotEnoughOptions = 2,
    InvalidOption = 3,
    InvalidDuration = 4,
    PollNotFound = 5,
    PollExpired = 6,
    PollInactive = 7,
    InvalidOptionIndex = 8,
    AlreadyVoted = 9,
    NotCreator = 10,
}

#[contract]
pub struct PollContract;

fn poll_or_error(env: &Env, poll_id: u32) -> Poll {
    env.storage()
        .persistent()
        .get(&DataKey::Poll(poll_id))
        .unwrap_or_else(|| panic_with_error!(env, PollError::PollNotFound))
}

fn validate_poll_input(env: &Env, question: &String, options: &Vec<String>, duration_minutes: u64) {
    if question.len() == 0 {
        panic_with_error!(env, PollError::InvalidQuestion);
    }

    if options.len() < 2 {
        panic_with_error!(env, PollError::NotEnoughOptions);
    }

    for option in options.iter() {
        if option.len() == 0 {
            panic_with_error!(env, PollError::InvalidOption);
        }
    }

    if duration_minutes == 0 {
        panic_with_error!(env, PollError::InvalidDuration);
    }
}

#[contractimpl]
impl PollContract {
    pub fn create_poll(
        env: Env,
        creator: Address,
        question: String,
        options: Vec<String>,
        duration_minutes: u64,
    ) -> u32 {
        creator.require_auth();
        validate_poll_input(&env, &question, &options, duration_minutes);

        let count: u32 = env.storage().persistent().get(&DataKey::PollCount).unwrap_or(0);
        let new_id = count + 1;

        let mut votes = Vec::new(&env);
        for _ in 0..options.len() {
            votes.push_back(0u32);
        }

        let now = env.ledger().timestamp();
        let poll = Poll {
            id: new_id,
            question,
            options,
            votes,
            created_at: now,
            expires_at: now + (duration_minutes * 60),
            creator: creator.clone(),
            active: true,
        };

        env.storage().persistent().set(&DataKey::Poll(new_id), &poll);
        env.storage().persistent().set(&DataKey::PollCount, &new_id);
        env.events()
            .publish((symbol_short!("poll"), symbol_short!("create"), new_id), creator);

        new_id
    }

    pub fn vote(env: Env, voter: Address, poll_id: u32, option_index: u32) {
        voter.require_auth();

        let mut poll = poll_or_error(&env, poll_id);
        let now = env.ledger().timestamp();

        if now > poll.expires_at {
            panic_with_error!(&env, PollError::PollExpired);
        }

        if !poll.active {
            panic_with_error!(&env, PollError::PollInactive);
        }

        if option_index >= poll.options.len() {
            panic_with_error!(&env, PollError::InvalidOptionIndex);
        }

        let user_vote_key = DataKey::UserVote(poll_id, voter.clone());
        if env.storage().persistent().has(&user_vote_key) {
            panic_with_error!(&env, PollError::AlreadyVoted);
        }

        let current_votes = poll.votes.get(option_index).unwrap_or(0);
        poll.votes.set(option_index, current_votes + 1);

        env.storage().persistent().set(&DataKey::Poll(poll_id), &poll);
        env.storage().persistent().set(&user_vote_key, &true);
        env.events().publish(
            (symbol_short!("poll"), symbol_short!("vote"), poll_id),
            option_index,
        );
    }

    pub fn get_poll(env: Env, poll_id: u32) -> Poll {
        poll_or_error(&env, poll_id)
    }

    pub fn get_polls(env: Env) -> Vec<Poll> {
        let count: u32 = env.storage().persistent().get(&DataKey::PollCount).unwrap_or(0);
        let mut polls = Vec::new(&env);

        for i in 1..=count {
            if let Some(poll) = env.storage().persistent().get(&DataKey::Poll(i)) {
                polls.push_back(poll);
            }
        }

        polls
    }

    pub fn get_active_polls(env: Env) -> Vec<Poll> {
        let all = Self::get_polls(env.clone());
        let now = env.ledger().timestamp();
        let mut active = Vec::new(&env);

        for poll in all.iter() {
            if poll.expires_at > now && poll.active {
                active.push_back(poll);
            }
        }

        active
    }

    pub fn get_expired_polls(env: Env) -> Vec<Poll> {
        let all = Self::get_polls(env.clone());
        let now = env.ledger().timestamp();
        let mut expired = Vec::new(&env);

        for poll in all.iter() {
            if poll.expires_at <= now || !poll.active {
                expired.push_back(poll);
            }
        }

        expired
    }

    pub fn get_poll_count(env: Env) -> u32 {
        env.storage().persistent().get(&DataKey::PollCount).unwrap_or(0)
    }

    pub fn has_voted(env: Env, poll_id: u32, voter: Address) -> bool {
        env.storage().persistent().has(&DataKey::UserVote(poll_id, voter))
    }

    pub fn close_poll(env: Env, poll_id: u32, caller: Address) {
        caller.require_auth();

        let mut poll = poll_or_error(&env, poll_id);
        if poll.creator != caller.clone() {
            panic_with_error!(&env, PollError::NotCreator);
        }

        poll.active = false;
        env.storage().persistent().set(&DataKey::Poll(poll_id), &poll);
        env.events()
            .publish((symbol_short!("poll"), symbol_short!("close"), poll_id), caller);
    }
}

