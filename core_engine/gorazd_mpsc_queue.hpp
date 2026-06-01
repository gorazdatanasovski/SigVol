#pragma once
#include <atomic>
#include <memory>

// SigVol: Sub-microsecond Multi-Producer Single-Consumer Lock-Free Queue
// Bypasses standard locks for deterministic delta-hedge order routing.

template<typename T>
class LockFreeExecutionQueue {
private:
    struct Node {
        std::shared_ptr<T> data;
        Node* next;
        Node() : next(nullptr) {}
    };
    std::atomic<Node*> head;
    std::atomic<Node*> tail;

public:
    LockFreeExecutionQueue() {
        Node* dummy = new Node();
        head.store(dummy);
        tail.store(dummy);
    }

    void enqueue_hedge_order(T order) {
        Node* newNode = new Node();
        newNode->data = std::make_shared<T>(order);
        Node* oldTail = tail.exchange(newNode, std::memory_order_acq_rel);
        oldTail->next = newNode;
    }
};
